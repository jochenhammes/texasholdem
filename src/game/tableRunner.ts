import type { BotInput, HandAction } from '../ai/decide';
import { makeProfile, type BotProfile, type Personality } from '../ai/profiles';
import { advance, applyAction, RuleError } from '../engine/engine';
import { nextFloat, nextInt, randomSeed, seedRng } from '../engine/rng';
import type { GameEvent, PlayerAction, PlayerId, PlayerKind, SeatPlayer, TableState } from '../engine/types';
import { toView } from '../engine/view';
import type { GameSetup, LoggedEvent } from './types';

/** Everything needed to continue a game (JSON-serializable). */
export interface GameData {
  setup: GameSetup;
  state: TableState;
  personalities: Record<string, Personality>;
  history: HandAction[];
  log: LoggedEvent[];
}

export interface TurnInfo {
  playerId: PlayerId;
  /** Epoch ms (local clock) when the turn times out, or null without a limit. */
  deadline: number | null;
}

export interface RunnerOptions {
  decideBot: (input: BotInput) => Promise<PlayerAction>;
  /** Delay multiplier (1 = normal). Read on every step so settings apply live. */
  speed: () => number;
  /** Additional factor, e.g. faster once the local player folded. */
  fastFactor?: () => number;
  /** Time limit for human decisions in ms (null = unlimited, single player). */
  turnTimeMs?: number | null;
  /** Disconnected players act (check/fold) almost immediately. */
  isAway?: (playerId: PlayerId) => boolean;
  /** When true, the table stops after each showdown until `continueAfterShowdown()`. */
  holdAfterShowdown?: () => boolean;
  /** Return true to hold the loop (e.g. local player busted and not spectating). */
  shouldHold?: () => boolean;
  /** Called after every state change, after history/log were updated. */
  onEvents: (events: GameEvent[]) => void;
  /** Called when non-state info changes (thinking bot, turn timer, pause). */
  onUpdate: () => void;
}

const AWAY_TIMEOUT_MS = 1500;
export const isHumanKind = (k: PlayerKind) => k === 'human' || k === 'remote';

/**
 * Drives a table: asks bots for decisions, waits for human input (with an
 * optional time limit) and advances streets/hands with pleasant pacing.
 * Environment-neutral – used by the single-player controller and by the
 * multiplayer host.
 */
export class TableRunner {
  thinkingId: PlayerId | null = null;
  turn: TurnInfo | null = null;
  paused = false;
  /** Stopped after a showdown, waiting for `continueAfterShowdown()`. */
  awaitingContinue = false;
  private continueGate: (() => void) | null = null;

  private profiles = new Map<string, BotProfile>();
  private running = false;
  private disposed = false;
  private resumeGate: (() => void) | null = null;
  private logId: number;
  private rng = seedRng(randomSeed());
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private turnTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly g: GameData,
    private opts: RunnerOptions,
  ) {
    this.logId = g.log.reduce((m, e) => Math.max(m, e.id), 0);
    for (const [id, pers] of Object.entries(g.personalities)) this.profiles.set(id, makeProfile(g.setup.difficulty, pers));
  }

  get state() {
    return this.g.state;
  }

  start() {
    void this.run();
  }

  /** Human input. Returns false if it is not this player's turn or the action is illegal. */
  act(playerId: PlayerId, action: PlayerAction): boolean {
    if (this.disposed) return false;
    const s = this.g.state;
    if (s.phase !== 'betting' || s.players[s.toAct]?.id !== playerId) return false;
    try {
      this.apply(applyAction(s, playerId, action));
    } catch (e) {
      if (e instanceof RuleError) return false;
      throw e;
    }
    this.clearTurn();
    void this.run();
    return true;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (!paused && this.resumeGate) {
      this.resumeGate();
      this.resumeGate = null;
    }
    this.opts.onUpdate();
    if (!paused) void this.run();
  }

  /** Re-evaluate holds and away players (call when presence or spectating changed). */
  nudge() {
    if (this.turn && this.opts.isAway?.(this.turn.playerId)) this.scheduleTurn(this.turn.playerId);
    void this.run();
  }

  continueAfterShowdown() {
    this.continueGate?.();
    this.continueGate = null;
  }

  dispose() {
    this.disposed = true;
    this.continueGate?.();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.clearTurn();
    this.resumeGate?.();
  }

  // ───────────── loop ─────────────

  private async run() {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      while (!this.disposed) {
        await this.waitIfPaused();
        const s = this.g.state;
        if (s.phase === 'tournamentComplete') break;
        if (this.opts.shouldHold?.()) break;
        if (s.phase === 'betting') {
          const p = s.players[s.toAct];
          if (isHumanKind(p.kind)) {
            if (!this.turn || this.turn.playerId !== p.id) this.scheduleTurn(p.id);
            break; // wait for act() or the time limit
          }
          await this.botTurn(p);
        } else {
          if (this.shouldHoldAfterShowdown(s)) {
            await this.holdForContinue();
            if (this.disposed) break;
            this.apply(advance(this.g.state));
            continue;
          }
          await this.sleep(this.delayFor(s));
          if (this.disposed) break;
          // the mode may have been switched on while we were waiting
          if (this.shouldHoldAfterShowdown(this.g.state)) continue;
          await this.waitIfPaused();
          if (this.g.state.phase === 'tournamentComplete' || this.g.state.phase === 'betting') continue;
          this.apply(advance(this.g.state));
        }
      }
    } finally {
      this.running = false;
    }
  }

  private shouldHoldAfterShowdown(s: TableState): boolean {
    return s.phase === 'handComplete' && !!s.lastResult?.showdown && !!this.opts.holdAfterShowdown?.();
  }

  private holdForContinue() {
    this.awaitingContinue = true;
    this.opts.onUpdate();
    return new Promise<void>((resolve) => {
      this.continueGate = () => {
        this.awaitingContinue = false;
        resolve();
      };
    });
  }

  private scheduleTurn(playerId: PlayerId) {
    this.clearTurn();
    const away = this.opts.isAway?.(playerId) ?? false;
    const limit = away ? AWAY_TIMEOUT_MS : (this.opts.turnTimeMs ?? null);
    this.turn = { playerId, deadline: limit === null ? null : Date.now() + limit };
    if (limit !== null) {
      const seq = this.g.state.seq;
      this.turnTimer = setTimeout(() => this.onTimeout(playerId, seq), limit);
    }
    this.opts.onUpdate();
  }

  private clearTurn() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turn = null;
  }

  private onTimeout(playerId: PlayerId, seq: number) {
    const s = this.g.state;
    if (this.disposed || s.seq !== seq || s.phase !== 'betting' || s.players[s.toAct]?.id !== playerId) return;
    if (this.paused) {
      // try again once the table is resumed
      this.turnTimer = setTimeout(() => this.onTimeout(playerId, seq), 1000);
      return;
    }
    const p = s.players[s.toAct];
    this.act(playerId, p.bet >= s.currentBet ? { type: 'check' } : { type: 'fold' });
  }

  private delayFor(s: TableState): number {
    const sp = this.opts.speed() * (this.opts.fastFactor?.() ?? 1);
    switch (s.phase) {
      case 'idle':
        return 400 * sp;
      case 'streetComplete':
        return (s.revealed.length ? 1300 : 750) * sp;
      case 'showdown':
        return 1100 * sp;
      case 'handComplete':
        return (s.lastResult?.showdown ? 3000 : 1700) * sp;
      default:
        return 500 * sp;
    }
  }

  private async botTurn(p: SeatPlayer) {
    const s = this.g.state;
    this.thinkingId = p.id;
    this.opts.onUpdate();
    const profile = this.profiles.get(p.id) ?? makeProfile(this.g.setup.difficulty, 'tag');
    const minThink = (450 + nextFloat(this.rng) * 900) * this.opts.speed() * (this.opts.fastFactor?.() ?? 1);
    const [action] = await Promise.all([
      this.opts.decideBot({ view: toView(s, p.id), profile, history: this.g.history, seed: nextInt(this.rng, 2 ** 31) }),
      this.sleep(minThink),
    ]);
    if (this.disposed) return;
    await this.waitIfPaused();
    this.thinkingId = null;
    if (s !== this.g.state || s.phase !== 'betting' || s.players[s.toAct]?.id !== p.id) return;
    try {
      this.apply(applyAction(s, p.id, action));
    } catch {
      this.apply(applyAction(s, p.id, s.players[s.toAct].bet >= s.currentBet ? { type: 'check' } : { type: 'fold' }));
    }
  }

  private apply(events: GameEvent[]) {
    const s = this.g.state;
    for (const e of events) {
      if (e.type === 'handStart') this.g.history = [];
      if (e.type === 'action') this.g.history.push({ playerId: e.playerId, street: s.street, type: e.action.type });
      if (e.type !== 'dealHole') this.g.log.push({ id: ++this.logId, hand: s.handNumber, event: e });
    }
    if (this.g.log.length > 400) this.g.log.splice(0, this.g.log.length - 400);
    this.opts.onEvents(events);
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        this.timers.delete(t);
        resolve();
      }, Math.max(0, ms));
      this.timers.add(t);
    });
  }

  private waitIfPaused() {
    if (!this.paused || this.disposed) return Promise.resolve();
    return new Promise<void>((resolve) => (this.resumeGate = resolve));
  }
}
