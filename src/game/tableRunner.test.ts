import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decide } from '../ai/decide';
import { createTournament } from '../engine/engine';
import { totalChips } from '../engine/engine';
import { TableRunner, type GameData } from './tableRunner';

function game(kinds: ('human' | 'remote' | 'bot')[]): GameData {
  const state = createTournament(
    { startingStack: 1000, handsPerLevel: 5, levels: [{ sb: 10, bb: 20, ante: 0 }, { sb: 50, bb: 100, ante: 10 }, { sb: 200, bb: 400, ante: 50 }] },
    kinds.map((kind, i) => ({ id: `p${i}`, name: `P${i}`, kind })),
    7,
  );
  const personalities: GameData['personalities'] = {};
  kinds.forEach((k, i) => k === 'bot' && (personalities[`p${i}`] = 'tag'));
  return {
    setup: { playerName: 'x', totalPlayers: kinds.length, difficulty: 'easy', startingStack: 1000, blindSpeed: 'turbo' },
    state,
    personalities,
    history: [],
    log: [],
  };
}

describe('TableRunner', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('auto-folds or checks a human who runs out of time', async () => {
    const g = game(['human', 'remote', 'bot']);
    const runner = new TableRunner(g, {
      decideBot: async (input) => decide({ ...input, profile: { ...input.profile, iterations: 30 } }).action,
      speed: () => 0.1,
      turnTimeMs: 30000,
      onEvents: () => {},
      onUpdate: () => {},
    });
    runner.start();
    // play until a human has to decide
    for (let i = 0; i < 200 && !runner.turn; i++) await vi.advanceTimersByTimeAsync(100);
    expect(runner.turn).not.toBeNull();
    const who = runner.turn!.playerId;
    expect(runner.turn!.deadline).not.toBeNull();
    await vi.advanceTimersByTimeAsync(30500);
    const actions = g.log.filter((l) => l.event.type === 'action' && l.event.playerId === who);
    expect(actions.length).toBeGreaterThan(0);
    expect(['fold', 'check']).toContain((actions[0].event as { action: { type: string } }).action.type);
    runner.dispose();
  });

  it('runs a whole tournament with humans that never act (timeouts only)', async () => {
    const g = game(['remote', 'remote', 'bot', 'bot']);
    const away = new Set(['p0', 'p1']);
    const runner = new TableRunner(g, {
      decideBot: async (input) => decide({ ...input, profile: { ...input.profile, iterations: 20 } }).action,
      speed: () => 0.05,
      turnTimeMs: 30000,
      isAway: (id) => away.has(id),
      onEvents: () => {},
      onUpdate: () => {},
    });
    runner.start();
    for (let i = 0; i < 20000 && g.state.phase !== 'tournamentComplete'; i++) await vi.advanceTimersByTimeAsync(500);
    expect(g.state.phase).toBe('tournamentComplete');
    expect(totalChips(g.state)).toBe(4000);
    runner.dispose();
  }, 60000);

  it('rejects actions from players who are not on turn', async () => {
    const g = game(['human', 'human']);
    const runner = new TableRunner(g, { decideBot: async () => ({ type: 'fold' }), speed: () => 0.1, onEvents: () => {}, onUpdate: () => {} });
    runner.start();
    for (let i = 0; i < 50 && !runner.turn; i++) await vi.advanceTimersByTimeAsync(100);
    const onTurn = runner.turn!.playerId;
    const other = onTurn === 'p0' ? 'p1' : 'p0';
    expect(runner.act(other, { type: 'fold' })).toBe(false);
    expect(runner.act(onTurn, { type: 'call' })).toBe(true);
    runner.dispose();
  });
});
