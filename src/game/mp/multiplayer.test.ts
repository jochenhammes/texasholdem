import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decide } from '../../ai/decide';
import type { GameSnapshot } from '../types';
import { GuestController } from './guestController';
import { HostController, newMultiplayerGame } from './hostController';
import { createRoom, joinRoom, paths, type Member, type RoomMeta } from './room';
import { MemoryStore, MemoryTransport } from './transport';

const setup = { playerName: 'Host', totalPlayers: 4, difficulty: 'easy' as const, startingStack: 1000, blindSpeed: 'turbo' as const };

async function table() {
  const store = new MemoryStore();
  const host = new MemoryTransport(store, 'H');
  const g1 = new MemoryTransport(store, 'G1');
  const g2 = new MemoryTransport(store, 'G2');
  const code = await createRoom(host, setup);
  expect(await joinRoom(g1, code, 'Anna')).toBe('ok');
  expect(await joinRoom(g2, code, 'Bert')).toBe('ok');
  const members = (await host.get<Record<string, Member>>(paths.members(code)))!;
  const data = newMultiplayerGame(setup, 'H', members);
  const hc = new HostController(host, code, data, {
    speed: () => 0.05,
    persist: false,
    decideBot: async (input) => decide({ ...input, profile: { ...input.profile, iterations: 20 } }).action,
  });
  const guest1 = new GuestController(g1, code, 'H');
  const guest2 = new GuestController(g2, code, 'H');
  const snaps: Record<string, GameSnapshot | null> = { H: null, G1: null, G2: null };
  hc.subscribe((s) => (snaps.H = s));
  guest1.subscribe((s) => (snaps.G1 = s));
  guest2.subscribe((s) => (snaps.G2 = s));
  return { store, code, hc, guest1, guest2, snaps, data, host, g1, g2 };
}

describe('multiplayer (in-memory transport)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('seats members plus bots and starts playing', async () => {
    const { data, store, code, hc, guest1, guest2 } = await table();
    expect(data.state.players).toHaveLength(4);
    expect(data.state.players.filter((p) => p.kind === 'remote').map((p) => p.id).sort()).toEqual(['G1', 'G2']);
    expect(data.state.players.filter((p) => p.kind === 'bot')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10);
    expect((store.read(paths.meta(code)) as RoomMeta).status).toBe('playing');
    [hc, guest1, guest2].forEach((c) => c.dispose());
  });

  it('guests only ever see their own hole cards', async () => {
    const { snaps, hc, guest1, guest2 } = await table();
    for (let i = 0; i < 100 && !snaps.G1; i++) await vi.advanceTimersByTimeAsync(50);
    const v = snaps.G1!.view;
    expect(v.viewerId).toBe('G1');
    for (const p of v.players) {
      if (p.id === 'G1') expect(p.holeCards.every((c) => c !== null)).toBe(true);
      else if (!v.lastResult?.showdown) expect(p.holeCards.every((c) => c === null)).toBe(true);
    }
    [hc, guest1, guest2].forEach((c) => c.dispose());
  });

  it('guest actions travel through the inbox and the game advances', async () => {
    const { snaps, hc, guest1, guest2, data } = await table();
    const guests = { G1: guest1, G2: guest2 };
    let guestActions = 0;
    for (let i = 0; i < 3000 && data.state.handNumber < 4; i++) {
      await vi.advanceTimersByTimeAsync(40);
      for (const id of ['G1', 'G2'] as const) {
        const s = snaps[id];
        if (s?.view.legal) {
          guests[id].act(s.view.legal.canCheck ? { type: 'check' } : { type: 'call' });
          guestActions++;
          await vi.advanceTimersByTimeAsync(5);
        }
      }
      if (snaps.H?.view.legal) hc.act({ type: 'fold' });
    }
    expect(data.state.handNumber).toBeGreaterThanOrEqual(4);
    expect(guestActions).toBeGreaterThan(3);
    // guest actions are in the log as real actions, not timeouts
    expect(data.log.some((l) => l.event.type === 'action' && l.event.playerId === 'G1' && l.event.action.type !== 'fold')).toBe(true);
    [hc, guest1, guest2].forEach((c) => c.dispose());
  });

  it('a guest that disconnects is auto-played and can rejoin', async () => {
    const { snaps, hc, guest1, guest2, data, store, code, g1 } = await table();
    guest1.dispose(); // removes presence → host treats G1 as away
    for (let i = 0; i < 1500 && data.state.handNumber < 3; i++) {
      await vi.advanceTimersByTimeAsync(40);
      if (snaps.G2?.view.legal) guest2.act({ type: 'fold' });
      if (snaps.H?.view.legal) hc.act({ type: 'fold' });
    }
    expect(data.state.handNumber).toBeGreaterThanOrEqual(3);
    // rejoin: same uid gets the current view again
    expect(await joinRoom(g1, code, 'Anna')).toBe('ok');
    let back: GameSnapshot | null = null;
    const again = new GuestController(new MemoryTransport(store, 'G1'), code, 'H');
    again.subscribe((s) => (back = s));
    await vi.advanceTimersByTimeAsync(20);
    expect(back!.view.viewerId).toBe('G1');
    [hc, again, guest2].forEach((c) => c.dispose());
    void g1;
  });

  it('nobody else can join once the game started', async () => {
    const { store, code, hc, guest1, guest2 } = await table();
    await vi.advanceTimersByTimeAsync(10);
    // (rules enforce this in Firebase; the client reports it too)
    const late = new MemoryTransport(store, 'LATE');
    expect(await joinRoom(late, code, 'Late')).toBe('started');
    [hc, guest1, guest2].forEach((c) => c.dispose());
  });
});
