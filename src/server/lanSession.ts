// The LAN tournament, held in the memory of the server process.
// Transport-agnostic: the Vite plugin wires it to HTTP + Server-Sent Events,
// the tests drive it directly.

import { decideWithFallback, type BotInput } from '../ai/decide';
import { randomPersonality, type Personality } from '../ai/profiles';
import { createTournament, type Entrant } from '../engine/engine';
import { randomSeed, seedRng, shuffle } from '../engine/rng';
import { makeTournamentConfig } from '../engine/tournament';
import type { GameEvent, PlayerAction } from '../engine/types';
import { toView } from '../engine/view';
import { BOT_NAMES } from '../game/botNames';
import { TableRunner, type GameData } from '../game/tableRunner';
import type { GameSetup } from '../game/types';
import { MAX_PLAYERS, type LanCommand, type LanMember, type LanMessage, type LanResult, type ViewPayload } from '../game/lan/protocol';

/** Allowed time limits per decision (seconds); none by default. */
export const TURN_TIME_MIN = 20;
export const TURN_TIME_MAX = 120;
/**
 * When the admin is gone, the tournament is reset (the next player becomes admin):
 * - after the browser was closed (it says goodbye): shortly – a reload reconnects well within this time;
 * - after the connection just dropped (Wi-Fi, standby, dead battery): only after a generous grace period,
 *   so short outages never end the tournament. Meanwhile the admin checks/folds automatically.
 */
export const ADMIN_BYE_GRACE_MS = 15_000;
export const ADMIN_LOST_GRACE_MS = 120_000;

const DEFAULT_SETUP: GameSetup = { playerName: '', totalPlayers: 6, difficulty: 'medium', startingStack: 1500, blindSpeed: 'normal', startLevel: 0, turnTimeSec: null, winChance: false };

export interface SessionOptions {
  decideBot?: (input: BotInput) => Promise<PlayerAction>;
  speed?: () => number;
  turnTimeMs?: number;
  byeGraceMs?: number;
  lostGraceMs?: number;
}

interface Member {
  name: string;
  joinedAt: number;
}

interface Game {
  data: GameData;
  runner: TableRunner;
  lastEvents: GameEvent[];
}

type Send = (msg: LanMessage) => void;

export class LanSession {
  private adminId: string | null = null;
  private members = new Map<string, Member>();
  private setup: GameSetup = { ...DEFAULT_SETUP };
  private game: Game | null = null;
  private tournament = 0;
  /** Open connections per client (a client may have several tabs). */
  private conns = new Map<string, Set<Send>>();
  private resetTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the pending reset happens (epoch ms), for the countdown shown to the others. */
  private resetAt: number | null = null;
  /** The admin closed the browser (sent goodbye) rather than just losing the connection. */
  private adminSaidBye = false;
  private broadcastQueued = false;
  private joinSeq = 0;

  constructor(private opts: SessionOptions = {}) {}

  // ───────────── connections ─────────────

  /** A browser opened the event stream. The very first one becomes admin. */
  connect(clientId: string, send: Send): () => void {
    let set = this.conns.get(clientId);
    if (!set) this.conns.set(clientId, (set = new Set()));
    set.add(send);
    if (clientId === this.adminId) {
      this.adminSaidBye = false; // back again (e.g. after a reload)
      this.clearReset();
    }
    if (!this.adminId) {
      this.adminId = clientId;
      this.addMember(clientId, this.setup.playerName);
    }
    this.presenceChanged();
    send(this.messageFor(clientId));
    return () => {
      set.delete(send);
      if (set.size === 0) this.conns.delete(clientId);
      this.presenceChanged();
    };
  }

  isOnline(clientId: string) {
    return this.conns.has(clientId);
  }

  // ───────────── commands ─────────────

  handle(clientId: string, c: LanCommand): LanResult {
    switch (c.cmd) {
      case 'join':
        return this.join(clientId, c.name);
      case 'setup':
        return this.updateSetup(clientId, c.setup);
      case 'start':
        return this.start(clientId);
      case 'act':
        return this.act(clientId, c.action);
      case 'leave':
        return this.leave(clientId);
      case 'end':
        return this.end(clientId);
      case 'bye':
        return this.bye(clientId);
      case 'log': {
        const who = this.members.get(clientId)?.name || clientId.slice(0, 6);
        console.warn(`  [${who}] ${String(c.text).slice(0, 500)}`);
        return { ok: true };
      }
      default:
        return { ok: false, error: 'badRequest' };
    }
  }

  join(clientId: string, name: string): LanResult {
    const clean = cleanName(name);
    if (!clean) return { ok: false, error: 'badRequest' };
    const m = this.members.get(clientId);
    if (m) m.name = clean;
    else {
      if (this.members.size >= this.capacity()) return { ok: false, error: 'full' };
      this.addMember(clientId, clean);
    }
    if (clientId === this.adminId) this.setup.playerName = clean;
    this.broadcast();
    return { ok: true };
  }

  updateSetup(clientId: string, setup: GameSetup): LanResult {
    if (clientId !== this.adminId) return { ok: false, error: 'notAdmin' };
    if (!setup || typeof setup !== 'object') return { ok: false, error: 'badRequest' };
    const total = clampInt(setup.totalPlayers, 2, MAX_PLAYERS);
    this.setup = {
      playerName: cleanName(setup.playerName ?? '') ?? '',
      totalPlayers: Math.max(total, Math.min(MAX_PLAYERS, this.members.size)),
      difficulty: ['easy', 'medium', 'hard'].includes(setup.difficulty) ? setup.difficulty : 'medium',
      startingStack: clampInt(setup.startingStack, 100, 1_000_000),
      blindSpeed: ['turbo', 'normal', 'slow'].includes(setup.blindSpeed) ? setup.blindSpeed : 'normal',
      startLevel: clampInt(setup.startLevel ?? 0, 0, 10),
      winChance: setup.winChance === true,
      turnTimeSec: setup.turnTimeSec == null ? null : clampInt(setup.turnTimeSec, TURN_TIME_MIN, TURN_TIME_MAX),
    };
    const me = this.members.get(clientId);
    if (me && this.setup.playerName) me.name = this.setup.playerName;
    this.broadcast();
    return { ok: true };
  }

  /** The admin goes to the table: the tournament starts for everybody. */
  start(clientId: string): LanResult {
    if (clientId !== this.adminId) return { ok: false, error: 'notAdmin' };
    if (this.game && this.game.data.state.phase !== 'tournamentComplete') return { ok: true };
    this.stopGame();
    const admin = this.members.get(clientId);
    if (admin && !admin.name) admin.name = this.setup.playerName || 'Admin';
    const data = newLanGame(this.setup, clientId, this.members);
    const game: Game = { data, lastEvents: [], runner: null as unknown as TableRunner };
    game.runner = new TableRunner(data, {
      decideBot: this.opts.decideBot ?? (async (input) => decideWithFallback(input)),
      speed: this.opts.speed ?? (() => 1),
      fastFactor: () => (this.humansStillInHand() ? 1 : 0.6),
      // no limit unless the admin set one; absent players still check/fold quickly
      turnTimeMs: this.opts.turnTimeMs ?? (this.setup.turnTimeSec ? this.setup.turnTimeSec * 1000 : null),
      isAway: (id) => !this.isOnline(id),
      onEvents: (events) => {
        game.lastEvents = events;
        this.broadcast();
      },
      onUpdate: () => this.broadcast(),
    });
    this.game = game;
    this.tournament++;
    this.broadcast();
    queueMicrotask(() => game.runner.start());
    return { ok: true };
  }

  act(clientId: string, action: PlayerAction): LanResult {
    if (!this.game) return { ok: false, error: 'notPlaying' };
    return this.game.runner.act(clientId, action) ? { ok: true } : { ok: false, error: 'illegal' };
  }

  /** Leave the foyer. The admin hands over to the next player. */
  leave(clientId: string): LanResult {
    if (this.game && this.isSeated(clientId)) return { ok: true }; // seats stay; the table plays on (check/fold)
    this.members.delete(clientId);
    if (clientId === this.adminId) this.handOver();
    this.broadcast();
    return { ok: true };
  }

  /** Admin: end the tournament for everybody (or leave the result screen) → back to the foyer. */
  end(clientId: string): LanResult {
    if (clientId !== this.adminId) return { ok: false, error: 'notAdmin' };
    this.stopGame();
    this.setup.totalPlayers = Math.max(this.setup.totalPlayers, Math.min(MAX_PLAYERS, this.members.size));
    this.presenceChanged();
    this.broadcast();
    return { ok: true };
  }

  /** Sent by the browser when the page is closed (navigator.sendBeacon). */
  bye(clientId: string): LanResult {
    if (clientId === this.adminId) {
      // usually arrives just before the event stream closes; if it is closed already,
      // restart the countdown with the short grace period
      // Start the short countdown right away – the event stream may close a little later
      // (or, in some browsers, only when the whole window goes). A reload reconnects
      // within the grace period and cancels it.
      this.adminSaidBye = true;
      this.clearReset();
      this.presenceChanged();
    }
    return { ok: true };
  }

  dispose() {
    this.stopGame();
    this.clearReset();
    this.conns.clear();
  }

  // ───────────── state for the clients ─────────────

  messageFor(clientId: string): LanMessage {
    const g = this.game;
    const seated = this.isSeated(clientId);
    let game: ViewPayload | null = null;
    if (g) {
      const turn = g.runner.turn;
      game = {
        view: toView(g.data.state, seated ? clientId : null),
        events: g.lastEvents,
        log: g.data.log.slice(-30),
        thinkingId: g.runner.thinkingId,
        winChance: g.data.setup.winChance === true,
        turn: turn ? { playerId: turn.playerId, remainingMs: turn.deadline === null ? null : Math.max(0, turn.deadline - Date.now()) } : null,
      };
    }
    return {
      you: { id: clientId, isAdmin: clientId === this.adminId, member: this.members.has(clientId), seated },
      phase: g ? 'playing' : 'lobby',
      tournament: this.tournament,
      adminId: this.adminId,
      members: this.memberList(),
      setup: this.setup,
      game,
      adminAway: this.resetAt !== null ? { resetInMs: Math.max(0, this.resetAt - Date.now()) } : null,
    };
  }

  // ───────────── internals ─────────────

  private capacity() {
    return MAX_PLAYERS;
  }

  private addMember(id: string, name: string) {
    this.members.set(id, { name, joinedAt: ++this.joinSeq });
  }

  private memberList(): LanMember[] {
    return [...this.members.entries()]
      .sort(([a, x], [b, y]) => (a === this.adminId ? -1 : b === this.adminId ? 1 : x.joinedAt - y.joinedAt))
      .map(([id, m]) => ({ id, name: m.name, online: this.isOnline(id), isAdmin: id === this.adminId }));
  }

  private isSeated(clientId: string) {
    return !!this.game?.data.state.players.some((p) => p.id === clientId);
  }

  private humansStillInHand() {
    return !!this.game?.data.state.players.some((p) => p.kind === 'remote' && !p.folded && !p.eliminated);
  }

  private stopGame() {
    this.game?.runner.dispose();
    this.game = null;
  }

  private presenceChanged() {
    this.game?.runner.nudge();
    const adminGone = !!this.adminId && (this.adminSaidBye || !this.isOnline(this.adminId));
    if (!adminGone) this.clearReset();
    else if (!this.resetTimer) {
      const ms = this.adminSaidBye ? (this.opts.byeGraceMs ?? ADMIN_BYE_GRACE_MS) : (this.opts.lostGraceMs ?? ADMIN_LOST_GRACE_MS);
      this.resetAt = Date.now() + ms;
      this.resetTimer = setTimeout(() => {
        this.resetTimer = null;
        this.resetAt = null;
        if (this.adminId && (this.adminSaidBye || !this.isOnline(this.adminId))) this.resetTournament();
      }, ms);
    }
    this.broadcast();
  }

  private clearReset() {
    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.resetTimer = null;
    this.resetAt = null;
  }

  /** The admin is gone for good: end the tournament, back to the foyer with a new admin. */
  private resetTournament() {
    const old = this.adminId;
    this.stopGame();
    this.adminSaidBye = false;
    this.handOver();
    if (old && old !== this.adminId) this.members.delete(old);
    this.broadcast();
  }

  /** The next online member (by sign-up order) becomes admin; nobody there → the next visitor. */
  private handOver() {
    const old = this.adminId;
    const next = this.memberList().find((m) => m.id !== old && m.online) ?? null;
    this.adminId = next?.id ?? null;
    if (!this.adminId) {
      // nobody left: the next one to connect starts fresh
      this.members.clear();
      this.setup = { ...DEFAULT_SETUP };
      const anyone = [...this.conns.keys()][0];
      if (anyone) {
        this.adminId = anyone;
        this.addMember(anyone, '');
      }
    } else {
      this.setup.playerName = this.members.get(this.adminId)?.name ?? '';
    }
  }

  private broadcast() {
    if (this.broadcastQueued) return;
    this.broadcastQueued = true;
    queueMicrotask(() => {
      this.broadcastQueued = false;
      for (const [id, sends] of this.conns) {
        const msg = this.messageFor(id);
        for (const send of sends) send(msg);
      }
    });
  }
}

/** Seats the signed-up players (admin first) and fills the remaining seats with bots. */
export function newLanGame(setup: GameSetup, adminId: string, members: Map<string, Member>): GameData {
  const seed = randomSeed();
  const rng = seedRng(seed ^ 0x2f6b9d1);
  const humans = [...members.entries()]
    .sort(([a, x], [b, y]) => (a === adminId ? -1 : b === adminId ? 1 : x.joinedAt - y.joinedAt))
    .slice(0, MAX_PLAYERS);
  const taken = new Set(humans.map(([, m]) => m.name.toLowerCase()));
  const names = shuffle([...BOT_NAMES], rng).filter((n) => !taken.has(n.toLowerCase()));
  const entrants: Entrant[] = humans.map(([id, m], i) => ({ id, name: m.name || `Spieler ${i + 1}`, kind: 'remote' }));
  const personalities: Record<string, Personality> = {};
  const total = Math.min(MAX_PLAYERS, Math.max(2, setup.totalPlayers, entrants.length));
  for (let i = 1; entrants.length < total; i++) {
    const id = `bot${i}`;
    entrants.push({ id, name: names[i - 1] ?? `Bot ${i}`, kind: 'bot' });
    personalities[id] = randomPersonality(setup.difficulty, rng);
  }
  const seated = shuffle(entrants, rng);
  const state = createTournament(makeTournamentConfig(setup.startingStack, setup.blindSpeed, setup.startLevel ?? 0), seated, seed);
  return { setup, state, personalities, history: [], log: [] };
}

function cleanName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const s = name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14);
  return s || null;
}

function clampInt(v: unknown, min: number, max: number) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
}
