import { fullDeck, type Card } from './cards';
import { describeHand, evaluate } from './evaluator';
import { computePots } from './pots';
import { nextInt, seedRng, shuffle } from './rng';
import { levelForHand } from './tournament';
import type {
  GameEvent,
  HandResult,
  LegalActions,
  PlayerAction,
  PlayerId,
  PlayerKind,
  PotResult,
  SeatPlayer,
  Street,
  TableState,
  TournamentConfig,
} from './types';

/**
 * Pure No-Limit Texas Hold'em rules engine.
 *
 * All functions operate on a plain, JSON-serializable `TableState` (mutated in
 * place) and return the list of events that happened. No timers, no DOM, no
 * randomness outside the seeded RNG in the state: the exact same module can run
 * in the browser today and on an authoritative game server later.
 */

export class RuleError extends Error {}

export interface Entrant {
  id: PlayerId;
  name: string;
  kind: PlayerKind;
}

export function createTournament(config: TournamentConfig, entrants: Entrant[], seed: number): TableState {
  if (entrants.length < 2 || entrants.length > 10) throw new RuleError('2–10 players required');
  const rng = seedRng(seed);
  const players: SeatPlayer[] = entrants.map((e, seat) => ({
    id: e.id,
    name: e.name,
    seat,
    kind: e.kind,
    stack: config.startingStack,
    bet: 0,
    committed: 0,
    holeCards: [],
    folded: false,
    allIn: false,
    acted: false,
    eliminated: false,
    lastAction: null,
    startStack: config.startingStack,
  }));
  return {
    version: 1,
    config,
    players,
    rng,
    deck: [],
    board: [],
    phase: 'idle',
    street: 'preflop',
    handNumber: 0,
    levelIndex: 0,
    buttonSeat: nextInt(rng, players.length),
    sbSeat: -1,
    bbSeat: -1,
    toAct: -1,
    currentBet: 0,
    lastRaiseSize: 0,
    pots: [],
    revealed: [],
    lastResult: null,
    placements: [],
    seq: 0,
  };
}

// ───────────────────────────── helpers ─────────────────────────────

const alive = (p: SeatPlayer) => !p.eliminated;
const inHand = (p: SeatPlayer) => !p.eliminated && !p.folded;
const canAct = (p: SeatPlayer) => inHand(p) && !p.allIn;

export function currentLevel(s: TableState) {
  return s.config.levels[s.levelIndex];
}

/** Next seat after `from` (exclusive, clockwise) matching `pred`, or -1. */
function nextSeat(s: TableState, from: number, pred: (p: SeatPlayer) => boolean): number {
  const n = s.players.length;
  for (let i = 1; i <= n; i++) {
    const seat = (from + i) % n;
    if (pred(s.players[seat])) return seat;
  }
  return -1;
}

export function playerById(s: TableState, id: PlayerId): SeatPlayer | undefined {
  return s.players.find((p) => p.id === id);
}

export function potTotal(s: TableState): number {
  return s.pots.reduce((a, p) => a + p.amount, 0) + s.players.reduce((a, p) => a + p.bet, 0);
}

function putChips(p: SeatPlayer, amount: number) {
  const a = Math.min(amount, p.stack);
  p.stack -= a;
  p.bet += a;
  p.committed += a;
  if (p.stack === 0) p.allIn = true;
  return a;
}

function needsAction(s: TableState, p: SeatPlayer) {
  return canAct(p) && (!p.acted || p.bet < s.currentBet);
}

function findNextToAct(s: TableState, from: number): number {
  const actors = s.players.filter(canAct);
  if (actors.length === 0) return -1;
  // A lone player who can still act and already matches the bet has nobody to play against.
  if (actors.length === 1 && actors[0].bet >= s.currentBet) return -1;
  return nextSeat(s, from, (p) => needsAction(s, p));
}

// ───────────────────────────── hand flow ─────────────────────────────

export function startHand(s: TableState): GameEvent[] {
  if (s.phase !== 'idle' && s.phase !== 'handComplete') throw new RuleError(`Cannot start hand in phase ${s.phase}`);
  const events: GameEvent[] = [];
  const living = s.players.filter(alive);
  if (living.length < 2) throw new RuleError('Not enough players');

  s.handNumber++;
  const lvl = levelForHand(s.config, s.handNumber);
  const levelChanged = lvl !== s.levelIndex;
  s.levelIndex = lvl;
  const level = currentLevel(s);

  for (const p of s.players) {
    p.bet = 0;
    p.committed = 0;
    p.holeCards = [];
    p.folded = p.eliminated;
    p.allIn = false;
    p.acted = false;
    p.lastAction = null;
    p.startStack = p.stack;
  }

  // Button: hand 1 uses the randomly drawn seat, afterwards it moves clockwise.
  if (s.handNumber === 1) {
    if (!alive(s.players[s.buttonSeat])) s.buttonSeat = nextSeat(s, s.buttonSeat, alive);
  } else {
    s.buttonSeat = nextSeat(s, s.buttonSeat, alive);
  }
  if (living.length === 2) {
    // Heads-up: the button posts the small blind and acts first pre-flop.
    s.sbSeat = s.buttonSeat;
    s.bbSeat = nextSeat(s, s.sbSeat, alive);
  } else {
    s.sbSeat = nextSeat(s, s.buttonSeat, alive);
    s.bbSeat = nextSeat(s, s.sbSeat, alive);
  }
  events.push({ type: 'handStart', handNumber: s.handNumber, buttonSeat: s.buttonSeat, levelIndex: s.levelIndex });
  if (levelChanged) events.push({ type: 'levelUp', levelIndex: lvl, level: level });

  s.board = [];
  s.pots = [];
  s.revealed = [];
  s.lastResult = null;
  s.street = 'preflop';

  if (level.ante > 0) {
    for (const p of s.players.filter(alive)) {
      const a = Math.min(level.ante, p.stack);
      p.stack -= a;
      p.committed += a;
      if (p.stack === 0) p.allIn = true;
      events.push({ type: 'blind', playerId: p.id, kind: 'ante', amount: a });
    }
    // antes go straight to the pot
    s.pots = computePots(s.players.map((p) => ({ id: p.id, amount: p.committed, folded: !inHand(p) })));
  }
  const sb = s.players[s.sbSeat];
  const bb = s.players[s.bbSeat];
  events.push({ type: 'blind', playerId: sb.id, kind: 'sb', amount: putChips(sb, level.sb) });
  events.push({ type: 'blind', playerId: bb.id, kind: 'bb', amount: putChips(bb, level.bb) });
  s.currentBet = level.bb;
  s.lastRaiseSize = level.bb;

  s.deck = shuffle(fullDeck(), s.rng);
  // deal two cards each, one at a time, starting left of the button
  for (let round = 0; round < 2; round++) {
    let seat = s.buttonSeat;
    for (let i = 0; i < living.length; i++) {
      seat = nextSeat(s, seat, alive);
      s.players[seat].holeCards.push(s.deck.pop()!);
    }
  }
  events.push({ type: 'dealHole' });

  s.toAct = findNextToAct(s, s.bbSeat);
  if (s.toAct < 0) events.push(...endBettingRound(s));
  else s.phase = 'betting';
  s.seq++;
  return events;
}

export function legalActions(s: TableState, seat: number): LegalActions | null {
  if (s.phase !== 'betting' || s.toAct !== seat) return null;
  const p = s.players[seat];
  const callAmount = Math.min(Math.max(0, s.currentBet - p.bet), p.stack);
  const othersCanAct = s.players.some((q) => q !== p && canAct(q));
  const maxRaiseTo = p.bet + p.stack;
  const minRaiseTo = Math.min(s.currentBet + s.lastRaiseSize, maxRaiseTo);
  const canRaise = !p.acted && p.stack > callAmount && othersCanAct && maxRaiseTo > s.currentBet;
  return {
    canFold: true,
    canCheck: callAmount === 0,
    callAmount,
    canRaise,
    isBet: s.currentBet === 0,
    minRaiseTo,
    maxRaiseTo,
    currentBet: s.currentBet,
    playerBet: p.bet,
  };
}

export function applyAction(s: TableState, playerId: PlayerId, action: PlayerAction): GameEvent[] {
  if (s.phase !== 'betting') throw new RuleError('No betting in progress');
  const p = s.players[s.toAct];
  if (!p || p.id !== playerId) throw new RuleError('Not your turn');
  const legal = legalActions(s, p.seat)!;
  const events: GameEvent[] = [];

  switch (action.type) {
    case 'fold':
      p.folded = true;
      p.lastAction = { type: 'fold', amount: 0 };
      break;
    case 'check':
      if (!legal.canCheck) throw new RuleError('Cannot check');
      p.lastAction = { type: 'check', amount: 0 };
      break;
    case 'call': {
      if (legal.callAmount === 0) throw new RuleError('Nothing to call');
      const added = putChips(p, legal.callAmount);
      p.lastAction = { type: p.allIn ? 'allin' : 'call', amount: p.allIn ? p.bet : added };
      break;
    }
    case 'raise': {
      if (!legal.canRaise) throw new RuleError('Cannot raise');
      const to = Math.floor(action.amount);
      if (!Number.isFinite(to) || to > legal.maxRaiseTo) throw new RuleError('Raise exceeds stack');
      if (to < legal.minRaiseTo && to !== legal.maxRaiseTo) throw new RuleError('Raise below minimum');
      if (to <= s.currentBet) throw new RuleError('Raise must exceed current bet');
      const wasBet = s.currentBet === 0;
      const increment = to - s.currentBet;
      putChips(p, to - p.bet);
      if (increment >= s.lastRaiseSize) {
        // full raise: re-opens the betting for everybody else
        s.lastRaiseSize = increment;
        for (const q of s.players) if (q !== p && canAct(q)) q.acted = false;
      }
      s.currentBet = to;
      p.lastAction = { type: p.allIn ? 'allin' : wasBet ? 'bet' : 'raise', amount: to };
      break;
    }
    default:
      throw new RuleError('Unknown action');
  }
  p.acted = true;
  events.push({ type: 'action', playerId: p.id, action: p.lastAction! });

  const remaining = s.players.filter(inHand);
  if (remaining.length === 1) {
    events.push(...returnUncalled(s), ...collectBets(s));
    events.push(...awardPots(s, false));
  } else {
    s.toAct = findNextToAct(s, p.seat);
    if (s.toAct < 0) events.push(...endBettingRound(s));
  }
  s.seq++;
  return events;
}

function endBettingRound(s: TableState): GameEvent[] {
  const events = [...returnUncalled(s), ...collectBets(s)];
  s.phase = 'streetComplete';
  s.toAct = -1;
  // Nobody (or only one player) can bet any more: cards go face up, the board is run out.
  const live = s.players.filter(inHand);
  if (s.players.filter(canAct).length <= 1 && s.street !== 'river') {
    const ids = live.map((p) => p.id).filter((id) => !s.revealed.includes(id));
    if (ids.length) {
      s.revealed.push(...ids);
      events.push({ type: 'reveal', playerIds: ids });
    }
  }
  return events;
}

function returnUncalled(s: TableState): GameEvent[] {
  let top: SeatPlayer | null = null;
  let second = 0;
  for (const p of s.players) {
    if (!top || p.bet > top.bet) {
      if (top) second = Math.max(second, top.bet);
      top = p;
    } else second = Math.max(second, p.bet);
  }
  if (!top || top.bet <= second) return [];
  const amount = top.bet - second;
  top.bet -= amount;
  top.committed -= amount;
  top.stack += amount;
  if (top.stack > 0) top.allIn = false;
  return [{ type: 'uncalledReturned', playerId: top.id, amount }];
}

function collectBets(s: TableState): GameEvent[] {
  const total = s.players.reduce((a, p) => a + p.bet, 0);
  for (const p of s.players) p.bet = 0;
  s.pots = computePots(s.players.map((p) => ({ id: p.id, amount: p.committed, folded: !inHand(p) })));
  return total > 0 ? [{ type: 'betsCollected', total }] : [];
}

const NEXT_STREET: Record<Street, Street | null> = { preflop: 'flop', flop: 'turn', turn: 'river', river: null };

/** Moves the hand forward from a waiting phase. */
export function advance(s: TableState): GameEvent[] {
  const events: GameEvent[] = [];
  switch (s.phase) {
    case 'idle':
    case 'handComplete':
      return startHand(s);
    case 'streetComplete': {
      const next = NEXT_STREET[s.street];
      if (!next) {
        s.phase = 'showdown';
        const ids = s.players.filter(inHand).map((p) => p.id).filter((id) => !s.revealed.includes(id));
        if (ids.length) {
          s.revealed.push(...ids);
          events.push({ type: 'reveal', playerIds: ids });
        }
        break;
      }
      s.deck.pop(); // burn
      const count = next === 'flop' ? 3 : 1;
      const cards: Card[] = [];
      for (let i = 0; i < count; i++) cards.push(s.deck.pop()!);
      s.board.push(...cards);
      s.street = next;
      s.currentBet = 0;
      s.lastRaiseSize = currentLevel(s).bb;
      for (const p of s.players) {
        p.acted = false;
        if (canAct(p)) p.lastAction = null;
      }
      events.push({ type: 'board', street: next, cards });
      s.toAct = findNextToAct(s, s.buttonSeat);
      // nobody left to bet: keep running out the board
      s.phase = s.toAct < 0 ? 'streetComplete' : 'betting';
      break;
    }
    case 'showdown':
      events.push(...awardPots(s, true));
      break;
    default:
      throw new RuleError(`Cannot advance from ${s.phase}`);
  }
  s.seq++;
  return events;
}

/** Order of seats starting left of the button (used for odd chips). */
function seatOrderFromButton(s: TableState): Map<PlayerId, number> {
  const n = s.players.length;
  const m = new Map<PlayerId, number>();
  for (let i = 1; i <= n; i++) m.set(s.players[(s.buttonSeat + i) % n].id, i);
  return m;
}

function awardPots(s: TableState, showdown: boolean): GameEvent[] {
  const events: GameEvent[] = [];
  const order = seatOrderFromButton(s);
  const result: HandResult = { showdown, pots: [], hands: {} };
  const scores = new Map<PlayerId, number>();

  if (showdown) {
    for (const p of s.players.filter(inHand)) {
      const d = describeHand([...p.holeCards, ...s.board]);
      scores.set(p.id, d.score);
      result.hands[p.id] = { key: d.key, score: d.score, best: d.best };
    }
  }

  s.pots.forEach((pot, potIndex) => {
    let candidates = pot.eligible.filter((id) => inHand(playerById(s, id)!));
    if (candidates.length === 0) candidates = s.players.filter(inHand).map((p) => p.id);
    let winners = candidates;
    if (showdown && candidates.length > 1) {
      const best = Math.max(...candidates.map((id) => scores.get(id) ?? evaluateFor(s, id)));
      winners = candidates.filter((id) => (scores.get(id) ?? evaluateFor(s, id)) === best);
    }
    winners = [...winners].sort((a, b) => order.get(a)! - order.get(b)!);
    const share = Math.floor(pot.amount / winners.length);
    let rest = pot.amount - share * winners.length;
    const potResult: PotResult = { potIndex, amount: pot.amount, winners: [] };
    for (const id of winners) {
      const amt = share + (rest > 0 ? 1 : 0);
      if (rest > 0) rest--;
      playerById(s, id)!.stack += amt;
      potResult.winners.push({ playerId: id, amount: amt });
    }
    if (showdown) {
      const h = result.hands[winners[0]];
      if (h) {
        potResult.handKey = h.key;
        potResult.best = h.best;
      }
    }
    result.pots.push(potResult);
    events.push({ type: 'potAwarded', ...potResult });
  });

  s.pots = [];
  s.lastResult = result;
  s.phase = 'handComplete';
  s.toAct = -1;
  events.push(...handleEliminations(s));
  return events;
}

function evaluateFor(s: TableState, id: PlayerId): number {
  const p = playerById(s, id)!;
  return evaluate([...p.holeCards, ...s.board]);
}

function handleEliminations(s: TableState): GameEvent[] {
  const events: GameEvent[] = [];
  const livingBefore = s.players.filter(alive).length;
  const busted = s.players
    .filter((p) => alive(p) && p.stack === 0)
    .sort((a, b) => b.startStack - a.startStack || a.seat - b.seat);
  busted.forEach((p, i) => {
    p.eliminated = true;
    const place = livingBefore - busted.length + 1 + i;
    s.placements.push({ playerId: p.id, place, handNumber: s.handNumber });
    events.push({ type: 'eliminated', playerId: p.id, place });
  });
  const living = s.players.filter(alive);
  if (living.length === 1) {
    s.placements.push({ playerId: living[0].id, place: 1, handNumber: s.handNumber });
    s.phase = 'tournamentComplete';
    events.push({ type: 'tournamentComplete', winnerId: living[0].id });
  }
  return events;
}

/** Total chips on the table (stacks + bets + pots). Constant during a tournament. */
export function totalChips(s: TableState): number {
  return s.players.reduce((a, p) => a + p.stack + p.bet, 0) + s.pots.reduce((a, p) => a + p.amount, 0);
}
