import { monteCarloEquity } from '../ai/equity';
import { seedRng } from '../engine/rng';
import type { TableView } from '../engine/view';

const ITERATIONS = 2500;
let memo: { key: string; value: number } | null = null;

/**
 * Own chance to win the hand (ties count half), 0–100, against the players still
 * in the hand holding random cards. Uses only what the viewer can see: their own
 * hole cards and the board – never other players' hidden cards.
 * Returns null when there is nothing to show (no cards, folded, hand over).
 */
export function winChance(view: TableView): number | null {
  if (view.phase !== 'betting' && view.phase !== 'streetComplete') return null;
  const me = view.players.find((p) => p.id === view.viewerId);
  if (!me || me.folded || me.eliminated) return null;
  const hole = me.holeCards.filter((c): c is number => c !== null);
  if (hole.length !== 2) return null;
  const opponents = view.players.filter((p) => p.id !== me.id && !p.folded && !p.eliminated).length;
  if (opponents === 0) return null;

  const key = `${hole.join(',')}|${view.board.join(',')}|${opponents}`;
  if (memo?.key === key) return memo.value;
  // fixed seed per situation: the number does not jitter when nothing changed
  let seed = 0;
  for (const c of [...hole, ...view.board, opponents]) seed = (seed * 131 + c + 1) >>> 0;
  const eq = monteCarloEquity(
    { hero: hole, board: view.board, opponentMinChen: new Array(opponents).fill(-10), iterations: ITERATIONS },
    seedRng(seed),
  );
  const value = Math.round(eq * 100);
  memo = { key, value };
  return value;
}
