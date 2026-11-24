import { afterEach, describe, expect, it } from 'vitest';
import type { LanMessage } from '../game/lan/protocol';
import { LanSession } from './lanSession';

const flush = () => new Promise((r) => setTimeout(r, 0));
const until = async (cond: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 5));
  }
};

let sessions: LanSession[] = [];
afterEach(() => {
  sessions.forEach((s) => s.dispose());
  sessions = [];
});

function make(opts: ConstructorParameters<typeof LanSession>[0] = {}) {
  const s = new LanSession({ speed: () => 0, turnTimeMs: 200, byeGraceMs: 30, lostGraceMs: 300, ...opts });
  sessions.push(s);
  return s;
}

function client(s: LanSession, id: string) {
  const c = { id, last: null as LanMessage | null, disconnect: () => {} };
  c.disconnect = s.connect(id, (m) => (c.last = m));
  return c;
}

const setup = { playerName: 'Anna', totalPlayers: 5, difficulty: 'easy' as const, startingStack: 1500, blindSpeed: 'turbo' as const, startLevel: 0 };

describe('LanSession', () => {
  it('makes the first visitor admin; later visitors join as players', async () => {
    const s = make();
    const admin = client(s, 'admin-0001');
    const bob = client(s, 'bob-00001');
    await flush();
    expect(admin.last!.you.isAdmin).toBe(true);
    expect(bob.last!.you.isAdmin).toBe(false);
    expect(bob.last!.you.member).toBe(false);
    expect(s.join('bob-00001', 'Bob')).toEqual({ ok: true });
    await flush();
    expect(admin.last!.members.map((m) => m.name)).toEqual(['', 'Bob']);
    expect(s.updateSetup('bob-00001', setup)).toEqual({ ok: false, error: 'notAdmin' });
    expect(s.start('bob-00001')).toEqual({ ok: false, error: 'notAdmin' });
  });

  it('allows at most 8 players and never fewer seats than players', async () => {
    const s = make();
    client(s, 'admin-0001');
    for (let i = 1; i <= 7; i++) {
      client(s, `guest-000${i}`);
      expect(s.join(`guest-000${i}`, `G${i}`).ok).toBe(true);
    }
    client(s, 'guest-0009');
    expect(s.join('guest-0009', 'Late')).toEqual({ ok: false, error: 'full' });
    s.updateSetup('admin-0001', { ...setup, totalPlayers: 3 });
    await flush();
    expect(s.messageFor('admin-0001').setup!.totalPlayers).toBe(8);
  });

  it('starts for everybody, fills the rest with bots and hides other cards', async () => {
    const s = make();
    const admin = client(s, 'admin-0001');
    const bob = client(s, 'bob-00001');
    s.join('bob-00001', 'Bob');
    s.updateSetup('admin-0001', setup);
    expect(s.start('admin-0001')).toEqual({ ok: true });
    await until(() => !!bob.last?.game && bob.last.game.view.handNumber >= 1);
    const v = bob.last!.game!.view;
    expect(bob.last!.phase).toBe('playing');
    expect(bob.last!.you.seated).toBe(true);
    expect(v.players).toHaveLength(5);
    expect(v.players.filter((p) => p.kind === 'bot')).toHaveLength(3);
    expect(v.players.find((p) => p.id === 'admin-0001')!.name).toBe('Anna');
    // Bob sees his own cards, never anybody else's (before a showdown)
    for (const p of v.players) {
      if (p.id === 'bob-00001') expect(p.holeCards.every((c) => c !== null)).toBe(true);
      else if (!v.lastResult?.showdown) expect(p.holeCards.every((c) => c === null)).toBe(true);
    }
    expect(admin.last!.you.seated).toBe(true);
  });

  it('accepts actions only from the player to act', async () => {
    const s = make();
    const admin = client(s, 'admin-0001');
    client(s, 'bob-00001');
    s.join('bob-00001', 'Bob');
    s.updateSetup('admin-0001', { ...setup, totalPlayers: 2 });
    s.start('admin-0001');
    await until(() => admin.last?.game?.view.phase === 'betting');
    const toAct = admin.last!.game!.view.toActId!;
    const other = toAct === 'admin-0001' ? 'bob-00001' : 'admin-0001';
    expect(s.act(other, { type: 'fold' })).toEqual({ ok: false, error: 'illegal' });
    expect(s.act(toAct, { type: 'fold' })).toEqual({ ok: true });
  });

  it('lets absent players check/fold automatically', async () => {
    const s = make({ lostGraceMs: 60_000 });
    const admin = client(s, 'admin-0001');
    const bob = client(s, 'bob-00001');
    s.join('bob-00001', 'Bob');
    s.updateSetup('admin-0001', { ...setup, totalPlayers: 2 });
    s.start('admin-0001');
    bob.disconnect();
    admin.disconnect();
    // nobody is there: the table keeps playing hands on its own
    await until(() => (s.messageFor('admin-0001').game?.view.handNumber ?? 0) >= 3, 8000);
  });

  it('shows the running table to late visitors as spectators', async () => {
    const s = make();
    client(s, 'admin-0001');
    s.updateSetup('admin-0001', setup);
    s.start('admin-0001');
    const late = client(s, 'late-00001');
    await until(() => !!late.last?.game && late.last.game.view.handNumber >= 1);
    expect(late.last!.you.seated).toBe(false);
    expect(late.last!.game!.view.viewerId).toBeNull();
    expect(late.last!.game!.view.players.every((p) => p.holeCards.every((c) => c === null) || !!late.last!.game!.view.lastResult?.showdown)).toBe(true);
    // signs up for the next tournament
    expect(s.join('late-00001', 'Lou').ok).toBe(true);
    expect(s.end('admin-0001')).toEqual({ ok: true });
    await flush();
    expect(late.last!.phase).toBe('lobby');
    expect(late.last!.members.map((m) => m.name)).toContain('Lou');
  });

  it('has no time limit by default; the admin may set 20–120 s', async () => {
    const s = new LanSession({ speed: () => 0 });
    sessions.push(s);
    const admin = client(s, 'admin-0001');
    s.updateSetup('admin-0001', { ...setup, totalPlayers: 2, turnTimeSec: 5 });
    expect(s.messageFor('admin-0001').setup!.turnTimeSec).toBe(20);
    s.updateSetup('admin-0001', { ...setup, totalPlayers: 2, turnTimeSec: 600 });
    expect(s.messageFor('admin-0001').setup!.turnTimeSec).toBe(120);
    s.updateSetup('admin-0001', { ...setup, totalPlayers: 2, turnTimeSec: null });
    s.start('admin-0001');
    await until(() => admin.last?.game?.turn?.playerId === 'admin-0001');
    expect(admin.last!.game!.turn!.remainingMs).toBeNull();
  });

  it('hands the admin role over when the admin is gone from the foyer', async () => {
    const s = make();
    const admin = client(s, 'admin-0001');
    const bob = client(s, 'bob-00001');
    s.join('bob-00001', 'Bob');
    admin.disconnect();
    await until(() => !!bob.last?.you.isAdmin, 1000);
    expect(bob.last!.adminId).toBe('bob-00001');
  });

  async function runningTable() {
    const s = make();
    const admin = client(s, 'admin-0001');
    const bob = client(s, 'bob-00001');
    s.join('bob-00001', 'Bob');
    s.updateSetup('admin-0001', { ...setup, totalPlayers: 3 });
    s.start('admin-0001');
    await until(() => (bob.last?.game?.view.handNumber ?? 0) >= 1);
    return { s, admin, bob };
  }

  it('resets the tournament shortly after the admin closed the browser', async () => {
    const { s, admin, bob } = await runningTable();
    s.bye('admin-0001'); // beacon from pagehide, then the stream closes
    admin.disconnect();
    await until(() => !!bob.last?.adminAway);
    await until(() => bob.last!.phase === 'lobby', 1000);
    expect(bob.last!.you.isAdmin).toBe(true);
    expect(bob.last!.members.map((m) => m.id)).toEqual(['bob-00001']);
  });

  it('keeps the tournament through short connection losses and reloads', async () => {
    const { s, admin, bob } = await runningTable();
    const t = bob.last!.tournament;
    // reload: goodbye + reconnect right away
    s.bye('admin-0001');
    admin.disconnect();
    const again = client(s, 'admin-0001');
    await new Promise((r) => setTimeout(r, 80));
    // short outage (shorter than the grace period for lost connections)
    again.disconnect();
    await until(() => !!bob.last?.adminAway);
    await new Promise((r) => setTimeout(r, 150));
    client(s, 'admin-0001');
    await until(() => bob.last!.adminAway === null);
    await new Promise((r) => setTimeout(r, 300));
    expect(bob.last!.phase).toBe('playing');
    expect(bob.last!.tournament).toBe(t);
    expect(bob.last!.adminId).toBe('admin-0001');
  });

  it('resets after the grace period when the admin does not come back', async () => {
    const { admin, bob } = await runningTable();
    admin.disconnect();
    await new Promise((r) => setTimeout(r, 150));
    expect(bob.last!.phase).toBe('playing');
    await until(() => bob.last!.phase === 'lobby', 1500);
    expect(bob.last!.you.isAdmin).toBe(true);
  });

  it('lets the admin decide on the win-chance display for everybody', async () => {
    const s = make();
    const admin = client(s, 'admin-0001');
    const bob = client(s, 'bob-00001');
    s.join('bob-00001', 'Bob');
    expect(s.messageFor('admin-0001').setup!.winChance).toBe(false);
    s.updateSetup('admin-0001', { ...setup, totalPlayers: 3, winChance: true });
    s.start('admin-0001');
    await until(() => !!bob.last?.game);
    expect(bob.last!.game!.winChance).toBe(true);
    expect(admin.last!.game!.winChance).toBe(true);
    expect(s.updateSetup('bob-00001', { ...setup, winChance: false })).toEqual({ ok: false, error: 'notAdmin' });
  });
});
