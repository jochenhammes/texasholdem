import type { Card } from './cards';
import type { CategoryKey } from './evaluator';
import type { RngState } from './rng';

export type PlayerId = string;
export type PlayerKind = 'human' | 'bot' | 'remote';
export type Street = 'preflop' | 'flop' | 'turn' | 'river';

/**
 * Engine phases. The engine never advances on its own: whoever drives it (the
 * local controller today, a server tomorrow) calls `advance()` when it is time
 * to move on. This makes pacing/animation a concern of the driver, not the rules.
 *
 *  idle ──startHand──▶ betting ──(round done)──▶ streetComplete ──advance──▶ betting | streetComplete (all-in run-out)
 *                                                    │ (river)
 *                                                    ▼
 *                                                showdown ──advance──▶ handComplete ──advance──▶ betting (next hand)
 *                                                                           │
 *                                                                           ▼
 *                                                                 tournamentComplete
 */
export type Phase =
  | 'idle'
  | 'betting'
  | 'streetComplete'
  | 'showdown'
  | 'handComplete'
  | 'tournamentComplete';

export interface BlindLevel {
  sb: number;
  bb: number;
  ante: number;
}

export interface TournamentConfig {
  startingStack: number;
  handsPerLevel: number;
  levels: BlindLevel[];
}

export type ActionLabel = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export interface LastAction {
  type: ActionLabel;
  /** For bet/raise/allin: the total bet ("raise to"); for call: amount added. */
  amount: number;
}

/** What a player sends to the engine. `amount` is the total "raise to" for bets/raises. */
export type PlayerAction =
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  | { type: 'raise'; amount: number };

export interface SeatPlayer {
  id: PlayerId;
  name: string;
  /** Fixed seat index = position in `TableState.players`. */
  seat: number;
  kind: PlayerKind;
  stack: number;
  /** Chips put in on the current street. */
  bet: number;
  /** Chips put in during the whole hand (antes included). */
  committed: number;
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
  /** Has acted since the last full raise on this street. */
  acted: boolean;
  eliminated: boolean;
  lastAction: LastAction | null;
  /** Stack at the start of the current hand (used to rank simultaneous busts). */
  startStack: number;
}

export interface Pot {
  amount: number;
  eligible: PlayerId[];
}

export interface PotWinner {
  playerId: PlayerId;
  amount: number;
}

export interface PotResult {
  potIndex: number;
  amount: number;
  winners: PotWinner[];
  /** Winning hand category (only on showdown). */
  handKey?: CategoryKey;
  /** Winning five cards (only on showdown). */
  best?: Card[];
}

export interface HandResult {
  showdown: boolean;
  pots: PotResult[];
  /** Best hand of every player that reached showdown. */
  hands: Record<PlayerId, { key: CategoryKey; score: number; best: Card[] }>;
}

export interface Placement {
  playerId: PlayerId;
  place: number;
  handNumber: number;
}

export interface TableState {
  version: 1;
  config: TournamentConfig;
  players: SeatPlayer[];
  rng: RngState;
  deck: Card[];
  board: Card[];
  phase: Phase;
  street: Street;
  handNumber: number;
  levelIndex: number;
  buttonSeat: number;
  sbSeat: number;
  bbSeat: number;
  /** Seat index of the player to act, or -1. */
  toAct: number;
  /** Highest total bet on this street. */
  currentBet: number;
  /** Size of the last full raise on this street (minimum raise increment). */
  lastRaiseSize: number;
  /** Pots collected from finished streets. */
  pots: Pot[];
  /** Players whose hole cards are face up. */
  revealed: PlayerId[];
  lastResult: HandResult | null;
  placements: Placement[];
  /** Monotonic counter, incremented on every state change. */
  seq: number;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  /** Chips needed to call (already capped at the stack). 0 if checking is possible. */
  callAmount: number;
  canRaise: boolean;
  /** True if no bet has been made on this street yet (UI label "Bet" instead of "Raise"). */
  isBet: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  currentBet: number;
  /** Chips already in front of the player on this street. */
  playerBet: number;
}

export type GameEvent =
  | { type: 'handStart'; handNumber: number; buttonSeat: number; levelIndex: number }
  | { type: 'levelUp'; levelIndex: number; level: BlindLevel }
  | { type: 'blind'; playerId: PlayerId; kind: 'sb' | 'bb' | 'ante'; amount: number }
  | { type: 'dealHole' }
  | { type: 'action'; playerId: PlayerId; action: LastAction }
  | { type: 'uncalledReturned'; playerId: PlayerId; amount: number }
  | { type: 'betsCollected'; total: number }
  | { type: 'board'; street: Street; cards: Card[] }
  | { type: 'reveal'; playerIds: PlayerId[] }
  | ({ type: 'potAwarded' } & PotResult)
  | { type: 'eliminated'; playerId: PlayerId; place: number }
  | { type: 'tournamentComplete'; winnerId: PlayerId };
