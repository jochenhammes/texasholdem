import type { GameEvent, PlayerId, Street } from '../engine/types';

/**
 * What the table has *seen* a player do during this tournament (public
 * information only – no hidden cards). Expert bots adapt their opponent
 * model to these numbers. Reset with every new tournament.
 */
export interface OpponentStats {
  hands: number;
  /** Hands with money put in voluntarily pre-flop. */
  vpip: number;
  /** Hands with a pre-flop raise. */
  pfr: number;
  /** Post-flop bets/raises. */
  aggr: number;
  /** Post-flop calls. */
  passive: number;
  /** Post-flop decisions facing a bet (call, raise or fold). */
  faced: number;
  /** …of which folds. */
  folded: number;
}

export type StatsTable = Record<PlayerId, OpponentStats>;

const empty = (): OpponentStats => ({ hands: 0, vpip: 0, pfr: 0, aggr: 0, passive: 0, faced: 0, folded: 0 });

/** Updates `table` in place from engine events. `street` = street of the state when the events were produced. */
export function trackStats(table: StatsTable, events: GameEvent[], street: Street, dealtIn: () => PlayerId[], perHand: { vpip: Set<string>; pfr: Set<string> }) {
  for (const e of events) {
    if (e.type === 'handStart') {
      perHand.vpip.clear();
      perHand.pfr.clear();
      for (const id of dealtIn()) (table[id] ??= empty()).hands++;
    }
    if (e.type !== 'action') continue;
    const st = (table[e.playerId] ??= empty());
    const t = e.action.type;
    if (street === 'preflop') {
      if ((t === 'call' || t === 'raise' || t === 'bet' || t === 'allin') && !perHand.vpip.has(e.playerId)) {
        perHand.vpip.add(e.playerId);
        st.vpip++;
      }
      if ((t === 'raise' || t === 'bet' || t === 'allin') && !perHand.pfr.has(e.playerId)) {
        perHand.pfr.add(e.playerId);
        st.pfr++;
      }
    } else {
      if (t === 'bet' || t === 'raise' || t === 'allin') st.aggr++;
      if (t === 'call') st.passive++;
      if (t === 'call' || t === 'raise' || t === 'fold') st.faced++;
      if (t === 'fold') st.folded++;
    }
  }
}

/** Smoothed tendencies (prior = a solid regular, so few observations don't swing things). */
export interface Tendencies {
  vpip: number;
  pfr: number;
  /** Aggression factor (bets+raises per call) post-flop. */
  af: number;
  /** Fold to a post-flop bet. */
  foldToBet: number;
}

export const DEFAULT_TENDENCIES: Tendencies = { vpip: 0.24, pfr: 0.16, af: 1.6, foldToBet: 0.45 };

export function tendencies(s: OpponentStats | undefined): Tendencies {
  if (!s) return DEFAULT_TENDENCIES;
  const d = DEFAULT_TENDENCIES;
  return {
    vpip: (s.vpip + 10 * d.vpip) / (s.hands + 10),
    pfr: (s.pfr + 10 * d.pfr) / (s.hands + 10),
    af: (s.aggr + 4 * d.af) / (s.passive + 4),
    foldToBet: (s.folded + 6 * d.foldToBet) / (s.faced + 6),
  };
}
