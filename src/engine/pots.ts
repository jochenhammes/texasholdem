import type { Pot, PlayerId } from './types';

export interface Contribution {
  id: PlayerId;
  amount: number;
  folded: boolean;
}

/**
 * Splits total hand contributions into a main pot and side pots.
 * Folded players' chips stay in the pots, but they are not eligible to win.
 */
export function computePots(contribs: Contribution[]): Pot[] {
  const live = contribs.filter((c) => !c.folded && c.amount > 0);
  if (live.length === 0) {
    const total = contribs.reduce((s, c) => s + c.amount, 0);
    return total > 0 ? [{ amount: total, eligible: [] }] : [];
  }
  const levels = [...new Set(live.map((c) => c.amount))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const c of contribs) amount += Math.max(0, Math.min(c.amount, level) - prev);
    const eligible = live.filter((c) => c.amount >= level).map((c) => c.id);
    if (amount > 0) {
      const last = pots[pots.length - 1];
      // merge pots with identical eligibility (e.g. after folds)
      if (last && sameSet(last.eligible, eligible)) last.amount += amount;
      else pots.push({ amount, eligible });
    }
    prev = level;
  }
  // chips of folded players above the highest live level go to the last pot
  let overflow = 0;
  for (const c of contribs) overflow += Math.max(0, c.amount - prev);
  if (overflow > 0 && pots.length) pots[pots.length - 1].amount += overflow;
  return pots;
}

function sameSet(a: PlayerId[], b: PlayerId[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}
