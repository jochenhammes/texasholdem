import { BotClient } from '../ai/botClient';
import type { HandAction } from '../ai/decide';
import { makeProfile, randomPersonality, type BotProfile, type Personality } from '../ai/profiles';
import { advance, applyAction, createTournament, RuleError, type Entrant } from '../engine/engine';
import { nextFloat, nextInt, randomSeed, seedRng, shuffle } from '../engine/rng';
import { makeTournamentConfig } from '../engine/tournament';
import type { GameEvent, PlayerAction, SeatPlayer, TableState } from '../engine/types';
import { toView } from '../engine/view';
import { storage, type SavedGame } from './storage';
import type { GameController, GameSetup, GameSnapshot, LoggedEvent } from './types';

export const HERO_ID = 'hero';

const BOT_NAMES = [
  'Ava', 'Ben', 'Chen', 'Dana', 'Emil', 'Fiona', 'Gus', 'Hana', 'Ivo', 'Jule', 'Kai', 'Lena',
  'Milo', 'Nora', 'Otto', 'Pia', 'Quinn', 'Rosa', 'Sam', 'Tara', 'Uli', 'Vera', 'Wes', 'Yara', 'Zoe',
];

export interface Pacing {
  /** Delay multiplier (1 = normal, < 1 = faster). Read on every step so settings apply live. */
  speed: () => number;
}

interface Internal {
  setup: GameSetup;
  state: TableState;
  personalities: Record<string, Personality>;
  history: HandAction[];
  log: LoggedEvent[];
  statsRecorded?: boolean;
}

export function newGame(setup: GameSetup): Internal {
  const seed = randomSeed();
  const rng = seedRng(seed ^ 0x5bd1e995);
  const names = shuffle([...BOT_NAMES], rng).filter((n) => n.toLowerCase() !== setup.playerName.trim().toLowerCase());
  const entrants: Entrant[] = [{ id: HERO_ID, name: setup.playerName.trim() || 'Du', kind: 'human' }];
  const personalities: Record<string, Personality> = {};
  for (let i = 1; i < setup.totalPlayers; i++) {
    const id = `bot${i}`;
    entrants.push({ id, name: names[i - 1], kind: 'bot' });
    personalities[id] = randomPersonality(setup.difficulty, rng);
  }
  const state = createTournament(makeTournamentConfig(setup.startingStack, setup.blindSpeed, setup.startLevel ?? 0), entrants, seed);
  return { setup, state, personalities, history: [], log: [] };
}

export class LocalGameController implements GameController {
  private g: Internal;
  private bots = new BotClient();
  private profiles = new Map<string, BotProfile>();
  private listeners = new Set<(s: GameSnapshot) => void>();
  private lastEvents: GameEvent[] = [];
  private thinkingId: string | null = null;
  private running = false;
  private disposed = false;
  private paused = false;
  private resumeGate: (() => void) | null = null;
  private spectating = false;
  private logId = 0;
  private rng = seedRng(randomSeed());
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    game: Internal | SavedGame,
    private pacing: Pacing,
  ) {
    this.g = {
      setup: game.setup,
      state: game.state,
      personalities: game.personalities,
      history: game.history ?? [],
      log: game.log ?? [],
      statsRecorded: game.statsRecorded,
    };
    this.logId = this.g.log.reduce((m, e) => Math.max(m, e.id), 0);
    for (const [id, pers] of Object.entries(this.g.personalities)) {
      this.profiles.set(id, makeProfile(this.g.setup.difficulty, pers));
    }
    this.persist();
    queueMicrotask(() => this.run());
  }

  // ───────────── public API ─────────────

  subscribe(run: (s: GameSnapshot) => void) {
    this.listeners.add(run);
    run(this.snapshot());
    return () => this.listeners.delete(run);
  }

  act(action: PlayerAction) {
    if (this.disposed) return;
    const s = this.g.state;
    if (s.phase !== 'betting' || s.players[s.toAct]?.id !== HERO_ID) return;
    try {
      this.apply(applyAction(s, HERO_ID, action));
    } catch (e) {
      if (e instanceof RuleError) {
        console.warn('Illegal action ignored:', e.message);
        return;
      }
      throw e;
    }
    this.run();
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (!paused && this.resumeGate) {
      this.resumeGate();
      this.resumeGate = null;
    }
    this.emit();
  }

  spectate() {
    this.spectating = true;
    this.emit();
    this.run();
  }

  dispose() {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.resumeGate?.();
    this.bots.dispose();
    this.listeners.clear();
  }

  // ───────────── game loop ─────────────

  private get hero(): SeatPlayer {
    return this.g.state.players.find((p) => p.id === HERO_ID)!;
  }

  private async run() {
    if (this.running || this.disposed) return;
    this.running = true;
    try {
      while (!this.disposed) {
        await this.waitIfPaused();
        const s = this.g.state;
        if (s.phase === 'tournamentComplete') break;
        if (this.hero.eliminated && !this.spectating) break;
        if (s.phase === 'betting') {
          const p = s.players[s.toAct];
          if (p.kind === 'human') break; // wait for act()
          await this.botTurn(p);
        } else {
          await this.sleep(this.delayFor(s));
          if (this.disposed) break;
          await this.waitIfPaused();
          if (this.g.state.phase === 'tournamentComplete') break;
          this.apply(advance(this.g.state));
        }
      }
    } finally {
      this.running = false;
    }
  }

  private fastFactor(): number {
    const h = this.hero;
    // once the hero is out of the hand, things may move a bit quicker
    return h.eliminated ? 0.45 : h.folded ? 0.6 : 1;
  }

  private delayFor(s: TableState): number {
    const sp = this.pacing.speed() * this.fastFactor();
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
    this.emit();
    const profile = this.profiles.get(p.id) ?? makeProfile(this.g.setup.difficulty, 'tag');
    const minThink = (450 + nextFloat(this.rng) * 900) * this.pacing.speed() * this.fastFactor();
    const [action] = await Promise.all([
      this.bots.decide({
        view: toView(s, p.id),
        profile,
        history: this.g.history,
        seed: nextInt(this.rng, 2 ** 31),
      }),
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
      if (e.type === 'handStart') {
        this.g.history = [];
        if (!this.hero.eliminated) this.bumpStats((st) => st.handsPlayed++);
      }
      if (e.type === 'action') this.g.history.push({ playerId: e.playerId, street: s.street, type: e.action.type });
      if (e.type !== 'dealHole') this.g.log.push({ id: ++this.logId, hand: s.handNumber, event: e });
      if (e.type === 'eliminated' && e.playerId === HERO_ID) this.recordResult(e.place);
      if (e.type === 'tournamentComplete' && e.winnerId === HERO_ID) this.recordResult(1);
    }
    if (this.g.log.length > 400) this.g.log.splice(0, this.g.log.length - 400);
    this.lastEvents = events;
    this.persist();
    this.emit();
  }

  private recordResult(place: number) {
    if (this.g.statsRecorded) return;
    this.g.statsRecorded = true;
    this.bumpStats((st) => {
      st.tournaments++;
      if (place === 1) st.wins++;
      st.bestPlace = st.bestPlace === null ? place : Math.min(st.bestPlace, place);
    });
  }

  private bumpStats(fn: (s: ReturnType<typeof storage.loadStats>) => void) {
    const st = storage.loadStats();
    fn(st);
    storage.saveStats(st);
  }

  private persist() {
    if (this.g.state.phase === 'tournamentComplete') {
      storage.clearGame();
      return;
    }
    storage.saveGame({
      version: 1,
      savedAt: Date.now(),
      setup: this.g.setup,
      state: this.g.state,
      personalities: this.g.personalities,
      history: this.g.history,
      log: this.g.log.slice(-150),
      statsRecorded: this.g.statsRecorded,
    });
  }

  private snapshot(): GameSnapshot {
    return {
      view: toView(this.g.state, HERO_ID),
      events: this.lastEvents,
      log: this.g.log,
      thinkingId: this.thinkingId,
      heroEliminated: this.hero.eliminated,
      spectating: this.spectating,
      paused: this.paused,
      personalities: this.g.personalities,
    };
  }

  private emit() {
    if (this.disposed) return;
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
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
