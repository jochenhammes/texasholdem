import type { Card } from './cards';
import { currentLevel, legalActions, potTotal } from './engine';
import type {
  BlindLevel,
  HandResult,
  LegalActions,
  Phase,
  Placement,
  PlayerId,
  PlayerKind,
  Pot,
  LastAction,
  Street,
  TableState,
} from './types';

/**
 * What a single player is allowed to see. The UI renders only this projection,
 * never the raw `TableState` — so the same UI works unchanged once the state
 * lives on a server and only views are sent over the wire.
 */
export interface PlayerView {
  id: PlayerId;
  name: string;
  seat: number;
  kind: PlayerKind;
  stack: number;
  bet: number;
  committed: number;
  /** `null` entries are face-down cards. Empty if not dealt in. */
  holeCards: (Card | null)[];
  folded: boolean;
  allIn: boolean;
  eliminated: boolean;
  lastAction: LastAction | null;
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  isToAct: boolean;
}

export interface TableView {
  viewerId: PlayerId | null;
  seq: number;
  phase: Phase;
  street: Street;
  handNumber: number;
  levelIndex: number;
  level: BlindLevel;
  nextLevel: BlindLevel | null;
  handsUntilNextLevel: number;
  board: Card[];
  pots: Pot[];
  potTotal: number;
  currentBet: number;
  players: PlayerView[];
  toActId: PlayerId | null;
  /** Legal actions for the viewer, if it is the viewer's turn. */
  legal: LegalActions | null;
  lastResult: HandResult | null;
  placements: Placement[];
  startingStack: number;
}

export function toView(s: TableState, viewerId: PlayerId | null): TableView {
  const level = currentLevel(s);
  const hpl = s.config.handsPerLevel;
  const hasNext = s.levelIndex < s.config.levels.length - 1;
  const viewer = viewerId ? s.players.find((p) => p.id === viewerId) : undefined;
  return {
    viewerId,
    seq: s.seq,
    phase: s.phase,
    street: s.street,
    handNumber: s.handNumber,
    levelIndex: s.levelIndex,
    level,
    nextLevel: hasNext ? s.config.levels[s.levelIndex + 1] : null,
    handsUntilNextLevel: hasNext ? hpl - ((Math.max(1, s.handNumber) - 1) % hpl) - 1 : 0,
    board: [...s.board],
    pots: s.pots.map((p) => ({ amount: p.amount, eligible: [...p.eligible] })),
    potTotal: potTotal(s),
    currentBet: s.currentBet,
    players: s.players.map((p) => {
      const visible = p.id === viewerId || s.revealed.includes(p.id);
      return {
        id: p.id,
        name: p.name,
        seat: p.seat,
        kind: p.kind,
        stack: p.stack,
        bet: p.bet,
        committed: p.committed,
        holeCards: p.holeCards.map((c) => (visible ? c : null)),
        folded: p.folded,
        allIn: p.allIn,
        eliminated: p.eliminated,
        lastAction: p.lastAction ? { ...p.lastAction } : null,
        isButton: s.handNumber > 0 && p.seat === s.buttonSeat,
        isSmallBlind: s.handNumber > 0 && p.seat === s.sbSeat,
        isBigBlind: s.handNumber > 0 && p.seat === s.bbSeat,
        isToAct: s.phase === 'betting' && p.seat === s.toAct,
      };
    }),
    toActId: s.phase === 'betting' && s.toAct >= 0 ? s.players[s.toAct].id : null,
    legal: viewer ? legalActions(s, viewer.seat) : null,
    lastResult: s.lastResult ? structuredClone(s.lastResult) : null,
    placements: s.placements.map((p) => ({ ...p })),
    startingStack: s.config.startingStack,
  };
}
