import type { PlayerAction } from '../../engine/types';
import type { TableView } from '../../engine/view';
import type { GameSetup, LoggedEvent } from '../types';
import type { Transport, Unsubscribe } from './transport';

/** Data layout in the Realtime Database (see firebase/database.rules.json). */
export const paths = {
  room: (code: string) => `rooms/${code}`,
  meta: (code: string) => `rooms/${code}/meta`,
  members: (code: string) => `rooms/${code}/members`,
  member: (code: string, uid: string) => `rooms/${code}/members/${uid}`,
  presence: (code: string) => `rooms/${code}/presence`,
  presenceOf: (code: string, uid: string) => `rooms/${code}/presence/${uid}`,
  view: (code: string, uid: string) => `rooms/${code}/views/${uid}`,
  inbox: (code: string) => `rooms/${code}/inbox`,
  inboxOf: (code: string, uid: string) => `rooms/${code}/inbox/${uid}`,
};

export type RoomStatus = 'lobby' | 'playing' | 'closed';

export interface RoomMeta {
  host: string;
  createdAt: number;
  status: RoomStatus;
  /** JSON-encoded `GameSetup` (kept as a string so the database never reshapes it). */
  setup: string;
}

export interface Member {
  name: string;
  joinedAt: number;
}

export interface RoomState {
  meta: RoomMeta | null;
  members: Record<string, Member>;
  presence: Record<string, boolean>;
}

/** What the host publishes for each guest (JSON string in `views/{uid}/data`). */
export interface ViewPayload {
  view: TableView;
  /** Events of the latest state change (for sounds); merge `log` by id. */
  events: LoggedEvent['event'][];
  log: LoggedEvent[];
  thinkingId: string | null;
  turn: { playerId: string; remainingMs: number | null } | null;
}

/** What a guest sends (JSON string in `inbox/{uid}/data`). */
export interface InboxMessage {
  seq: number;
  action: PlayerAction;
}

// Unambiguous characters only (no 0/O, 1/I/L)
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newRoomCode(): string {
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  return [...a].map((n) => ALPHABET[n % ALPHABET.length]).join('');
}

export function normalizeCode(code: string): string | null {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 6 && [...c].every((ch) => ALPHABET.includes(ch)) ? c : null;
}

export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}#room=${code}`;
}

export function roomFromHash(hash = location.hash): string | null {
  const m = /room=([A-Za-z0-9-]+)/.exec(hash);
  return m ? normalizeCode(m[1]) : null;
}

export async function createRoom(t: Transport, setup: GameSetup): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newRoomCode();
    if (await t.get(paths.meta(code))) continue;
    const meta: RoomMeta = { host: t.uid, createdAt: Date.now(), status: 'lobby', setup: JSON.stringify(setup) };
    await t.set(paths.meta(code), meta);
    await t.set(paths.member(code, t.uid), { name: setup.playerName || 'Host', joinedAt: Date.now() } satisfies Member);
    return code;
  }
  throw new Error('Could not create a room');
}

export type JoinResult = 'ok' | 'notFound' | 'started' | 'closed';

export async function joinRoom(t: Transport, code: string, name: string): Promise<JoinResult> {
  const meta = await t.get<RoomMeta>(paths.meta(code));
  if (!meta) return 'notFound';
  if (meta.status === 'closed') return 'closed';
  if (meta.host === t.uid) return 'ok';
  const isMember = meta.status === 'lobby' || (await t.get(paths.member(code, t.uid)).catch(() => null)) !== null;
  if (!isMember) return 'started';
  try {
    await t.set(paths.member(code, t.uid), { name: name.slice(0, 24) || 'Gast', joinedAt: Date.now() } satisfies Member);
  } catch {
    return 'started';
  }
  return 'ok';
}

/** Lobby/room state for the waiting room (members only). */
export function watchRoom(t: Transport, code: string, cb: (s: RoomState) => void): Unsubscribe {
  const state: RoomState = { meta: null, members: {}, presence: {} };
  const emit = () => cb({ meta: state.meta, members: { ...state.members }, presence: { ...state.presence } });
  const subs = [
    t.on<RoomMeta>(paths.meta(code), (v) => {
      state.meta = v;
      emit();
    }),
    t.on<Record<string, Member>>(paths.members(code), (v) => {
      state.members = v ?? {};
      emit();
    }),
    t.on<Record<string, boolean>>(paths.presence(code), (v) => {
      state.presence = v ?? {};
      emit();
    }),
  ];
  return () => subs.forEach((u) => u());
}

export const parseSetup = (meta: RoomMeta): GameSetup => JSON.parse(meta.setup) as GameSetup;
