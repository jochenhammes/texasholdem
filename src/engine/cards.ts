/**
 * Cards are encoded as integers 0..51 for speed and compact serialization:
 *   rank = card >> 2   (0 = deuce … 12 = ace)
 *   suit = card & 3    (0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades)
 */
export type Card = number;

export const RANKS = '23456789TJQKA';
export const SUITS = 'cdhs';
export const SUIT_SYMBOLS = ['♣', '♦', '♥', '♠'] as const;

export const rankOf = (c: Card): number => c >> 2;
export const suitOf = (c: Card): number => c & 3;
export const makeCard = (rank: number, suit: number): Card => (rank << 2) | suit;

export function cardToString(c: Card): string {
  return RANKS[rankOf(c)] + SUITS[suitOf(c)];
}

export function parseCard(s: string): Card {
  const r = RANKS.indexOf(s[0].toUpperCase());
  const su = SUITS.indexOf(s[1].toLowerCase());
  if (r < 0 || su < 0) throw new Error(`Invalid card: ${s}`);
  return makeCard(r, su);
}

export function parseCards(s: string): Card[] {
  return s.trim().split(/\s+/).filter(Boolean).map(parseCard);
}

/** Rank label for display ("10" instead of "T"). */
export function rankLabel(c: Card): string {
  const r = RANKS[rankOf(c)];
  return r === 'T' ? '10' : r;
}

export function fullDeck(): Card[] {
  const d: Card[] = [];
  for (let i = 0; i < 52; i++) d.push(i);
  return d;
}
