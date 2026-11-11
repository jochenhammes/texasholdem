import { rankOf } from '../engine/cards';
import { describeHand } from '../engine/evaluator';
import type { HandResult } from '../engine/types';
import type { TableView } from '../engine/view';
import { chips, handName, t } from '../i18n/index.svelte';

/** Display information shared by every table design (derived from the player view only). */
export interface TableInfo {
  result: HandResult | null;
  showdownDone: boolean;
  wonBy: Record<string, number>;
  bestCards: number[];
  winnerLine: string | null;
  potLabel: string | null;
  heroHint: string | null;
}

export function tableInfo(view: TableView, handHints: boolean): TableInfo {
  const me = view.viewerId;
  const result = view.phase === 'handComplete' || view.phase === 'tournamentComplete' ? view.lastResult : null;
  const wonBy: Record<string, number> = {};
  for (const pot of result?.pots ?? []) for (const w of pot.winners) wonBy[w.playerId] = (wonBy[w.playerId] ?? 0) + w.amount;

  let winnerLine: string | null = null;
  const main = result?.pots[0];
  if (main) {
    const who = main.winners
      .map((w) => (w.playerId === me ? t('you') : (view.players.find((p) => p.id === w.playerId)?.name ?? '?')))
      .join(' & ');
    const amount = chips(main.amount);
    winnerLine =
      main.winners.length > 1
        ? main.handKey
          ? t('splitPotWith', { name: who, hand: handName(main.handKey) })
          : `${t('splitPot')} · ${who}`
        : main.handKey
          ? t('winsWith', { name: who, amount, hand: handName(main.handKey) })
          : t('wins', { name: who, amount });
  }

  // Hero's current hand, e.g. "Zwei Paare"
  let heroHint: string | null = null;
  const hero = view.players.find((p) => p.id === me);
  if (handHints && hero && !hero.folded && !hero.eliminated && !result) {
    const cards = hero.holeCards.filter((c): c is number => c !== null);
    if (cards.length === 2) {
      if (view.board.length >= 3) heroHint = handName(describeHand([...cards, ...view.board]).key);
      else if (rankOf(cards[0]) === rankOf(cards[1])) heroHint = handName('pair');
    }
  }

  return {
    result,
    showdownDone: !!result?.showdown,
    wonBy,
    bestCards: result?.pots[0]?.best ?? [],
    winnerLine,
    potLabel: view.pots.length > 1 ? view.pots.map((p) => chips(p.amount)).join(' · ') : null,
    heroHint,
  };
}
