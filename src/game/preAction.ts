import type { LegalActions, PlayerAction, PlayerId, Street } from '../engine/types';
import type { TableView } from '../engine/view';

/**
 * Pre-selected actions ("advance actions"): the player decides while others are
 * still acting. Actions tied to a bet level (check, call X, raise to X) become
 * void as soon as somebody changes the bet; the player then decides again.
 * Pure client-side logic, independent of where the game runs.
 */
export type PreAction =
  | { type: 'checkFold' }
  | { type: 'fold' }
  | { type: 'check'; level: number }
  | { type: 'call'; level: number; amount: number }
  | { type: 'callAny' }
  | { type: 'raise'; level: number; to: number };

export interface QueuedPreAction {
  action: PreAction;
  hand: number;
  street: Street;
}

/** What the hero could do once it is their turn, projected from the current view. */
export function projectedLegal(view: TableView, heroId: PlayerId): LegalActions | null {
  if (view.phase !== 'betting' || view.toActId === heroId) return null;
  const hero = view.players.find((p) => p.id === heroId);
  if (!hero || hero.folded || hero.allIn || hero.eliminated || hero.holeCards.length === 0) return null;
  // nothing to decide (yet) if we already acted and matched the bet – only a raise brings us back
  if (hero.acted && hero.bet >= view.currentBet) return null;
  const callAmount = Math.min(Math.max(0, view.currentBet - hero.bet), hero.stack);
  const maxRaiseTo = hero.bet + hero.stack;
  const othersCanAct = view.players.some((p) => p.id !== heroId && !p.folded && !p.eliminated && !p.allIn);
  return {
    canFold: true,
    canCheck: callAmount === 0,
    callAmount,
    canRaise: hero.stack > callAmount && othersCanAct && maxRaiseTo > view.currentBet,
    isBet: view.currentBet === 0,
    minRaiseTo: Math.min(view.currentBet + view.minRaise, maxRaiseTo),
    maxRaiseTo,
    currentBet: view.currentBet,
    playerBet: hero.bet,
  };
}

const levelOf = (a: PreAction): number | null => ('level' in a ? a.level : null);

/** Returns `false` if the queued action no longer fits the table (new street/hand or changed bet). */
export function isStillValid(q: QueuedPreAction, view: TableView, heroId: PlayerId): boolean {
  if (q.hand !== view.handNumber || q.street !== view.street) return false;
  const hero = view.players.find((p) => p.id === heroId);
  if (!hero || hero.folded || hero.allIn || hero.eliminated) return false;
  const level = levelOf(q.action);
  return level === null || level === view.currentBet;
}

/** Turns a queued pre-action into a concrete action once it is the hero's turn (or `null` if void). */
export function resolvePreAction(a: PreAction, legal: LegalActions): PlayerAction | null {
  const checkOr = (alt: PlayerAction): PlayerAction => (legal.canCheck ? { type: 'check' } : alt);
  switch (a.type) {
    case 'checkFold':
    case 'fold':
      // never fold when checking is free
      return checkOr({ type: 'fold' });
    case 'check':
      return legal.canCheck ? { type: 'check' } : null;
    case 'call':
      return legal.currentBet === a.level ? checkOr({ type: 'call' }) : null;
    case 'callAny':
      return checkOr({ type: 'call' });
    case 'raise':
      if (legal.currentBet !== a.level || !legal.canRaise) return null;
      return { type: 'raise', amount: Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, a.to)) };
  }
}
