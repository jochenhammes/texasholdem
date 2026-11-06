import { BotClient } from '../../ai/botClient';
import type { BotInput } from '../../ai/decide';
import { randomPersonality, type Personality } from '../../ai/profiles';
import { createTournament, type Entrant } from '../../engine/engine';
import { randomSeed, seedRng, shuffle } from '../../engine/rng';
import { makeTournamentConfig } from '../../engine/tournament';
import type { GameEvent, PlayerAction, PlayerId } from '../../engine/types';
import { toView } from '../../engine/view';
import { BOT_NAMES } from '../localController';
import { TableRunner, type GameData } from '../tableRunner';
import type { GameController, GameSetup, GameSnapshot } from '../types';
import { paths, type InboxMessage, type Member, type RoomMeta, type ViewPayload } from './room';
import type { Transport, Unsubscribe } from './transport';

export const TURN_TIME_MS = 30_000;
const HOST_SAVE_KEY = 'holdem.mp.host.v1';

export interface HostSave {
  room: string;
  uid: string;
  data: GameData;
}

/** Seats the waiting-room members (host first, by join time) and fills the rest with bots. */
export function newMultiplayerGame(setup: GameSetup, hostUid: string, members: Record<string, Member>): GameData {
  const seed = randomSeed();
  const rng = seedRng(seed ^ 0x2f6b9d1);
  const humans = Object.entries(members)
    .sort(([a, x], [b, y]) => (a === hostUid ? -1 : b === hostUid ? 1 : x.joinedAt - y.joinedAt))
    .slice(0, Math.max(2, setup.totalPlayers));
  const taken = new Set(humans.map(([, m]) => m.name.toLowerCase()));
  const names = shuffle([...BOT_NAMES], rng).filter((n) => !taken.has(n.toLowerCase()));
  const entrants: Entrant[] = humans.map(([uid, m]) => ({
    id: uid,
    name: m.name,
    kind: uid === hostUid ? 'human' : 'remote',
  }));
  const personalities: Record<string, Personality> = {};
  const total = Math.max(2, setup.totalPlayers, entrants.length);
  for (let i = 1; entrants.length < total; i++) {
    const id = `bot${i}`;
    entrants.push({ id, name: names[i - 1] ?? `Bot ${i}`, kind: 'bot' });
    personalities[id] = randomPersonality(setup.difficulty, rng);
  }
  // random seating
  const seated = shuffle(entrants, rng);
  const state = createTournament(makeTournamentConfig(setup.startingStack, setup.blindSpeed, setup.startLevel ?? 0), seated, seed);
  return { setup, state, personalities, history: [], log: [] };
}

export const hostSaves = {
  load(): HostSave | null {
    try {
      return JSON.parse(localStorage.getItem(HOST_SAVE_KEY) ?? 'null');
    } catch {
      return null;
    }
  },
  save(s: HostSave) {
    try {
      localStorage.setItem(HOST_SAVE_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  },
  clear() {
    try {
      localStorage.removeItem(HOST_SAVE_KEY);
    } catch {
      /* ignore */
    }
  },
};

export interface HostOptions {
  speed: () => number;
  decideBot?: (input: BotInput) => Promise<PlayerAction>;
  /** Persist to localStorage (off in tests). */
  persist?: boolean;
}

/**
 * Multiplayer host: runs the table in this browser and publishes each guest's
 * personal view through the transport. Guests send actions to their inbox.
 */
export class HostController implements GameController {
  private runner: TableRunner;
  private listeners = new Set<(s: GameSnapshot) => void>();
  private lastEvents: GameEvent[] = [];
  private presence: Record<string, boolean> = {};
  private inboxSeq = new Map<string, number>();
  private inboxPrimed = false;
  private subs: Unsubscribe[] = [];
  private spectating = false;
  private disposed = false;
  private wakeLock: { release(): Promise<void> } | null = null;
  private bots: BotClient | null = null;

  constructor(
    private t: Transport,
    readonly room: string,
    private data: GameData,
    private opts: HostOptions,
  ) {
    this.runner = new TableRunner(data, {
      decideBot: opts.decideBot ?? ((input) => (this.bots ??= new BotClient()).decide(input)),
      speed: opts.speed,
      fastFactor: () => (this.humansStillInHand() ? 1 : 0.6),
      turnTimeMs: TURN_TIME_MS,
      isAway: (id) => this.isRemote(id) && !this.presence[id],
      onEvents: (events) => {
        this.lastEvents = events;
        this.persist();
        this.publish();
        this.emit();
      },
      onUpdate: () => {
        this.publish();
        this.emit();
      },
    });

    this.subs.push(
      t.presence(paths.presenceOf(room, t.uid)),
      t.on<Record<string, boolean>>(paths.presence(room), (p) => {
        this.presence = p ?? {};
        this.runner.nudge();
      }),
      t.on<Record<string, { data: string }>>(paths.inbox(room), (inbox) => this.onInbox(inbox ?? {})),
    );
    this.persist();
    void this.t.update({ [`${paths.meta(room)}/status`]: 'playing' }).catch(() => {});
    this.publish();
    queueMicrotask(() => this.runner.start());
    void this.keepAwake();
  }

  // ───────────── GameController ─────────────

  subscribe(run: (s: GameSnapshot) => void) {
    this.listeners.add(run);
    run(this.snapshot());
    return () => this.listeners.delete(run);
  }

  act(action: PlayerAction) {
    this.runner.act(this.t.uid, action);
  }

  /** The table keeps running for the guests – the menu does not pause multiplayer. */
  setPaused() {}

  spectate() {
    this.spectating = true;
    this.emit();
  }

  dispose() {
    this.disposed = true;
    this.runner.dispose();
    this.bots?.dispose();
    this.subs.forEach((u) => u());
    this.subs = [];
    this.listeners.clear();
    void this.wakeLock?.release().catch(() => {});
  }

  /** Ends the table for everyone and deletes it. */
  async close() {
    this.dispose();
    if (this.opts.persist !== false) hostSaves.clear();
    await this.t.remove(paths.room(this.room)).catch(() => {});
  }

  // ───────────── internals ─────────────

  private isRemote(id: PlayerId) {
    return this.data.state.players.find((p) => p.id === id)?.kind === 'remote';
  }

  private humansStillInHand() {
    return this.data.state.players.some((p) => (p.kind === 'human' || p.kind === 'remote') && !p.folded && !p.eliminated);
  }

  private onInbox(inbox: Record<string, { data: string }>) {
    for (const [uid, entry] of Object.entries(inbox)) {
      let msg: InboxMessage;
      try {
        msg = JSON.parse(entry.data) as InboxMessage;
      } catch {
        continue;
      }
      const last = this.inboxSeq.get(uid) ?? -1;
      if (msg.seq <= last) continue;
      this.inboxSeq.set(uid, msg.seq);
      // actions that were already waiting when we (re)started are stale
      if (!this.inboxPrimed) continue;
      if (this.isRemote(uid)) this.runner.act(uid, msg.action);
    }
    this.inboxPrimed = true;
  }

  private publish() {
    if (this.disposed) return;
    const s = this.data.state;
    const turn = this.runner.turn
      ? { playerId: this.runner.turn.playerId, remainingMs: this.runner.turn.deadline === null ? null : Math.max(0, this.runner.turn.deadline - Date.now()) }
      : null;
    const updates: Record<string, unknown> = {};
    const logTail = this.data.log.slice(-30);
    for (const p of s.players) {
      if (p.kind !== 'remote') continue;
      const payload: ViewPayload = {
        view: toView(s, p.id),
        events: this.lastEvents,
        log: logTail,
        thinkingId: this.runner.thinkingId,
        turn,
      };
      updates[paths.view(this.room, p.id)] = { data: JSON.stringify(payload) };
    }
    if (Object.keys(updates).length) void this.t.update(updates).catch((e) => console.warn('publish failed', e));
  }

  private persist() {
    if (this.opts.persist === false) return;
    if (this.data.state.phase === 'tournamentComplete') hostSaves.clear();
    else hostSaves.save({ room: this.room, uid: this.t.uid, data: this.data });
  }

  private snapshot(): GameSnapshot {
    const me = this.data.state.players.find((p) => p.id === this.t.uid);
    const turn = this.runner.turn;
    return {
      view: toView(this.data.state, this.t.uid),
      events: this.lastEvents,
      log: this.data.log,
      thinkingId: this.runner.thinkingId,
      heroEliminated: !!me?.eliminated,
      spectating: this.spectating,
      paused: false,
      personalities: this.data.personalities,
      turn: turn ? { playerId: turn.playerId, deadline: turn.deadline } : null,
      multiplayer: { room: this.room, isHost: true },
    };
  }

  private emit() {
    if (this.disposed) return;
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  /** Keep the host's screen on – if it sleeps, the table pauses for everyone. */
  private async keepAwake() {
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }) : null;
    if (!nav?.wakeLock) return;
    const request = async () => {
      if (this.disposed || document.visibilityState !== 'visible') return;
      try {
        this.wakeLock = await nav.wakeLock!.request('screen');
      } catch {
        /* not allowed – fine */
      }
    };
    await request();
    document.addEventListener('visibilitychange', request);
    this.subs.push(() => document.removeEventListener('visibilitychange', request));
  }
}

export type { RoomMeta };
