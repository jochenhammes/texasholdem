import type { GameEvent, PlayerAction } from '../../engine/types';
import type { GameController, GameSnapshot, LoggedEvent } from '../types';
import type { LanConnection } from './client';
import type { LanMessage, ViewPayload } from './protocol';

/**
 * A seat (or a spectator's chair) at the LAN table. The game runs on the
 * server; this shows the personal view it sends and passes actions back.
 * Implements the same `GameController` as single player, so `Game.svelte`
 * works unchanged.
 */
export class LanController implements GameController {
  private listeners = new Set<(s: GameSnapshot) => void>();
  private snap: GameSnapshot | null = null;
  private log: LoggedEvent[] = [];
  private lastSeq = -1;
  private lastEvents: GameEvent[] = [];
  private deadline: { key: string; at: number | null } | null = null;
  private payload: ViewPayload | null = null;
  private isAdmin = false;
  private adminAwayUntil: number | null = null;
  private spectating = false;
  private subs: (() => void)[] = [];

  constructor(private conn: LanConnection) {
    this.subs.push(
      conn.onMessage((m) => this.onMessage(m)),
      conn.onStatus(() => this.rebuild()),
    );
  }

  subscribe(run: (s: GameSnapshot) => void) {
    this.listeners.add(run);
    if (this.snap) run(this.snap);
    return () => this.listeners.delete(run);
  }

  act(action: PlayerAction) {
    void this.conn.send({ cmd: 'act', action });
  }

  /** The shared table never pauses for one player. */
  setPaused() {}
  continueAfterShowdown() {}

  spectate() {
    this.spectating = true;
    this.rebuild();
  }

  dispose() {
    this.subs.forEach((u) => u());
    this.subs = [];
    this.listeners.clear();
  }

  private onMessage(m: LanMessage) {
    this.isAdmin = m.you.isAdmin;
    this.adminAwayUntil = m.adminAway && !m.you.isAdmin ? Date.now() + m.adminAway.resetInMs : null;
    const p = m.game;
    if (!p) return;
    const first = !this.payload;
    this.payload = p;
    // merge the log (the server sends the most recent entries)
    const known = new Set(this.log.map((l) => l.id));
    for (const l of p.log) if (!known.has(l.id)) this.log.push(l);
    this.log.sort((a, b) => a.id - b.id);
    if (this.log.length > 400) this.log.splice(0, this.log.length - 400);
    // events only count once per state change
    if (p.view.seq !== this.lastSeq) {
      this.lastSeq = p.view.seq;
      this.lastEvents = first ? [] : p.events;
    }
    // turn deadline relative to our own clock
    if (p.turn) {
      const key = `${p.turn.playerId}:${p.view.seq}`;
      if (this.deadline?.key !== key) this.deadline = { key, at: p.turn.remainingMs === null ? null : Date.now() + p.turn.remainingMs };
    } else this.deadline = null;
    this.rebuild();
  }

  private rebuild() {
    const p = this.payload;
    if (!p) return;
    const me = p.view.players.find((x) => x.id === p.view.viewerId);
    this.snap = {
      view: p.view,
      events: this.lastEvents,
      log: this.log,
      thinkingId: p.thinkingId,
      heroEliminated: !!me?.eliminated,
      spectating: this.spectating || !me,
      paused: false,
      personalities: {},
      turn: p.turn && this.deadline ? { playerId: p.turn.playerId, deadline: this.deadline.at } : null,
      hostAway: !this.conn.online,
      adminAwayUntil: this.adminAwayUntil,
      closed: false,
      multiplayer: { room: 'LAN', isHost: this.isAdmin },
      awaitingContinue: false,
    };
    // events are played once – later rebuilds (status changes) must not repeat sounds
    this.lastEvents = [];
    for (const l of this.listeners) l(this.snap);
  }
}
