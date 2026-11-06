import type { GameEvent, PlayerAction } from '../../engine/types';
import type { GameController, GameSnapshot, LoggedEvent } from '../types';
import { paths, type InboxMessage, type RoomMeta, type ViewPayload } from './room';
import type { Transport, Unsubscribe } from './transport';

/**
 * Multiplayer guest: shows the personal view the host publishes and sends
 * actions to its inbox. Holds no game logic and never sees other players' cards.
 */
export class GuestController implements GameController {
  private listeners = new Set<(s: GameSnapshot) => void>();
  private snap: GameSnapshot | null = null;
  private log: LoggedEvent[] = [];
  private lastSeq = -1;
  private lastEvents: GameEvent[] = [];
  private deadline: { key: string; at: number | null } | null = null;
  private hostAway = false;
  private closed = false;
  private spectating = false;
  private subs: Unsubscribe[] = [];

  constructor(
    private t: Transport,
    readonly room: string,
    private host: string,
    /** Called once the first view arrived (the guest is seated). */
    private onReady?: () => void,
  ) {
    this.subs.push(
      t.presence(paths.presenceOf(room, t.uid)),
      t.on<{ data: string }>(paths.view(room, t.uid), (v) => v && this.onView(v.data)),
      t.on<boolean>(paths.presenceOf(room, host), (present) => {
        this.hostAway = !present;
        this.rebuild();
      }),
      t.on<RoomMeta>(paths.meta(room), (meta) => {
        this.closed = !meta || meta.status === 'closed';
        this.rebuild();
      }),
    );
  }

  get isClosed() {
    return this.closed;
  }

  subscribe(run: (s: GameSnapshot) => void) {
    this.listeners.add(run);
    if (this.snap) run(this.snap);
    return () => this.listeners.delete(run);
  }

  act(action: PlayerAction) {
    const msg: InboxMessage = { seq: Date.now(), action };
    void this.t.set(paths.inboxOf(this.room, this.t.uid), { data: JSON.stringify(msg) }).catch((e) => console.warn('send failed', e));
  }

  setPaused() {}

  spectate() {
    this.spectating = true;
    this.rebuild();
  }

  dispose() {
    this.subs.forEach((u) => u());
    this.subs = [];
    this.listeners.clear();
  }

  private payload: ViewPayload | null = null;

  private onView(data: string) {
    let p: ViewPayload;
    try {
      p = JSON.parse(data) as ViewPayload;
    } catch {
      return;
    }
    const first = !this.payload;
    this.payload = p;
    // merge the log (the host sends the most recent entries)
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
      if (this.deadline?.key !== key) {
        this.deadline = { key, at: p.turn.remainingMs === null ? null : Date.now() + p.turn.remainingMs };
      }
    } else this.deadline = null;
    this.rebuild();
    if (first) this.onReady?.();
  }

  private rebuild() {
    const p = this.payload;
    if (!p) return;
    const me = p.view.players.find((x) => x.id === this.t.uid);
    this.snap = {
      view: p.view,
      events: this.lastEvents,
      log: this.log,
      thinkingId: p.thinkingId,
      heroEliminated: !!me?.eliminated,
      spectating: this.spectating,
      paused: this.hostAway,
      personalities: {},
      turn: p.turn && this.deadline ? { playerId: p.turn.playerId, deadline: this.deadline.at } : null,
      hostAway: this.hostAway && !this.closed,
      closed: this.closed,
      multiplayer: { room: this.room, isHost: false },
    };
    for (const l of this.listeners) l(this.snap);
  }
}
