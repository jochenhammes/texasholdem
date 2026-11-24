import { describe, expect, it } from 'vitest';
import { parseCards } from '../engine/cards';
import type { TableView } from '../engine/view';
import { winChance } from './winChance';

function view(hole: string, board: string, opponents: number, over: Partial<TableView> = {}): TableView {
  const mk = (id: string, cards: (number | null)[], folded = false) => ({ id, holeCards: cards, folded, eliminated: false }) as unknown as TableView['players'][number];
  return {
    viewerId: 'me',
    phase: 'betting',
    board: board ? parseCards(board) : [],
    players: [mk('me', parseCards(hole)), ...Array.from({ length: opponents }, (_, i) => mk(`o${i}`, [null, null]))],
    ...over,
  } as TableView;
}

describe('winChance', () => {
  it('matches known pre-flop equities', () => {
    expect(winChance(view('As Ah', '', 1))!).toBeGreaterThan(80);
    expect(winChance(view('As Ah', '', 1))!).toBeLessThan(88);
    expect(winChance(view('7c 2d', '', 1))!).toBeLessThan(40);
  });
  it('drops with more opponents and is certain with the nuts on the river', () => {
    expect(winChance(view('As Ah', '', 5))!).toBeLessThan(winChance(view('As Ah', '', 1))!);
    expect(winChance(view('As Ks', 'Qs Js Ts 2d 3c', 3))).toBe(100);
  });
  it('shows nothing without cards, after folding or when the hand is over', () => {
    expect(winChance(view('As Ah', '', 0))).toBeNull();
    expect(winChance(view('As Ah', '', 2, { phase: 'handComplete' }))).toBeNull();
    const v = view('As Ah', '', 2);
    v.players[0].folded = true;
    expect(winChance(v)).toBeNull();
    expect(winChance(view('As Ah', '', 2, { viewerId: null }))).toBeNull();
  });
});
