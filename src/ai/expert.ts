import type { Card } from '../engine/cards';
import { evaluate } from '../engine/evaluator';
import { nextFloat, nextUint32, seedRng, type RngState } from '../engine/rng';
import type { PlayerAction, PlayerId, Street } from '../engine/types';
import type { PlayerView, TableView } from '../engine/view';
import type { BotDecision, BotInput, HandAction } from './decide';
import { Bucket, classify } from './handClass';
import {
  applyPostflopAction,
  bucketsOn,
  callShovePct,
  COMBO_A,
  COMBO_B,
  COMBO_COUNT,
  COMBO_PCT,
  fullRange,
  handPct,
  openPct,
  preflopActionWeight,
  RangeSampler,
  removeCards,
  shapeByPct,
  totalWeight,
  type PreflopActionCtx,
  type Range,
  PREFLOP_FLOOR,
  POSTFLOP_SOFTNESS,
} from './ranges';
import { DEFAULT_TENDENCIES, tendencies, type StatsTable } from './opponentStats';

/** Tunables (overridable by the benchmark via globalThis.__expertTune). */
const TUNE = {
  defence: 1.3,
  /** Softmax temperature as a fraction of the pot (randomness in close spots). */
  temp: 0.01,
  /** Extra EV required per chip when risking a big part of the stack (tournament survival). */
  risk: 0.08,
  /** Adapt pre-flop opening/3-bet ranges to observed opponents (1 = on). */
  adapt: 1,
  /** Value of checking (check-raise, pot control) for the out-of-position player without initiative, × pot. */
  donk: 0.08,
  /** One bet size per street for value and bluffs alike – sizes reveal nothing (1 = on). */
  fixedSizes: 1,
  /** Assume tighter ranges for all-in shoves before calling them (1 = on). */
  strictShove: 1,
  /** Heads-up: the button raises more instead of limping (1 = on). */
  huOpen: 1,
  /** Pure push/fold only from this effective stack (big blinds) down – above it, normal raises. */
  pushBB: 8,
  /** Re-shove over a raise only from this effective stack down (unless the raise commits us anyway). */
  reshoveBB: 12,
  /** Lower bound for how much an aggressive player's bets still say about their hand (× default). */
  minSoft: 0.75,
  /** Raise size facing a bet, as a multiple of that bet (fixed sizing mode). */
  raiseX: 3,
  /** Fewer bluffs assumed in turn/river bets (1 = on). */
  later: 1,
  /** Equity realisation out of position. */
  oop: 0.9,
  ...((globalThis as { __expertTune?: Record<string, number> }).__expertTune ?? {}),
};
const DEFENCE = TUNE.defence;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** How a specific opponent deviates from a solid regular, from what we observed. */
function readsOf(c: Ctx, id: PlayerId) {
  const t = tendencies(c.stats?.[id]);
  return {
    widenRaise: clamp(t.pfr / DEFAULT_TENDENCIES.pfr, 0.6, 4),
    widenCall: clamp(t.vpip / DEFAULT_TENDENCIES.vpip, 0.6, 3.5),
    // very aggressive players' bets say little about their hand
    softness: Math.min(1, POSTFLOP_SOFTNESS * clamp(DEFAULT_TENDENCIES.af / t.af, TUNE.minSoft, 1.6)),
    // players who rarely fold get bluffed less
    defence: clamp((DEFENCE * (1 - t.foldToBet)) / (1 - DEFAULT_TENDENCIES.foldToBet), 0.7, 2.2),
  };
}

/**
 * "Experte": range-based, expected-value driven decisions.
 *
 * Pre-flop: position-dependent opening/3-bet/defend ranges, EV-based
 * push/fold with short stacks. Post-flop: every opponent gets a weighted
 * range that is narrowed by each of their actions; for fold, check/call and
 * several bet sizes the bot estimates the expected value including fold
 * equity, then picks (with a little randomness so it can't be read).
 */

const BOARD_LEN: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5 };

interface Ctx {
  view: TableView;
  me: PlayerView;
  hero: Card[];
  board: Card[];
  bb: number;
  pot: number;
  history: HandAction[];
  rng: RngState;
  opponents: PlayerView[];
  /** Pre-flop acting order (alive players, first to act first). */
  order: PlayerId[];
  budget: number;
  stats?: StatsTable;
}

// ───────────── equity vs weighted ranges ─────────────

function equityVs(hero: Card[], board: Card[], ranges: Range[], iterations: number, rng: RngState): number {
  const samplers = ranges.map((r) => new RangeSampler(r)).filter((s) => !s.empty);
  if (samplers.length === 0) return 1;
  const used = new Uint32Array(52);
  const heroCards = new Int32Array(7);
  const oppCards = new Int32Array(7);
  const full = new Int32Array(5);
  const opp = new Int32Array(samplers.length * 2);
  heroCards[0] = hero[0];
  heroCards[1] = hero[1];
  for (let i = 0; i < board.length; i++) full[i] = board[i];
  let total = 0;
  let done = 0;
  for (let it = 1; it <= iterations; it++) {
    const stamp = it;
    used[hero[0]] = stamp;
    used[hero[1]] = stamp;
    for (const c of board) used[c] = stamp;
    let ok = true;
    for (let o = 0; o < samplers.length; o++) {
      let tries = 0;
      for (;;) {
        const k = samplers[o].sample(rng);
        const a = COMBO_A[k],
          b = COMBO_B[k];
        if (used[a] !== stamp && used[b] !== stamp) {
          used[a] = stamp;
          used[b] = stamp;
          opp[o * 2] = a;
          opp[o * 2 + 1] = b;
          break;
        }
        if (++tries > 40) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
    }
    if (!ok) continue;
    for (let i = board.length; i < 5; i++) {
      let c: number;
      do c = nextUint32(rng) % 52;
      while (used[c] === stamp);
      used[c] = stamp;
      full[i] = c;
    }
    for (let i = 0; i < 5; i++) heroCards[2 + i] = oppCards[2 + i] = full[i];
    const hs = evaluate(heroCards, 7);
    let ties = 0;
    let lost = false;
    for (let o = 0; o < samplers.length; o++) {
      oppCards[0] = opp[o * 2];
      oppCards[1] = opp[o * 2 + 1];
      const s = evaluate(oppCards, 7);
      if (s > hs) {
        lost = true;
        break;
      }
      if (s === hs) ties++;
    }
    if (!lost) total += 1 / (ties + 1);
    done++;
  }
  return done ? total / done : 0.5;
}

// ───────────── reading the hand history ─────────────

function preflopOrder(view: TableView): PlayerId[] {
  const alive = view.players.filter((p) => !p.eliminated);
  const bbIdx = alive.findIndex((p) => p.isBigBlind);
  return alive.map((_, i) => alive[(bbIdx + 1 + i) % alive.length].id);
}

/** Reconstructs each player's pre-flop actions with context (raises before, position, sizes). */
function preflopContexts(c: Ctx): Map<PlayerId, PreflopActionCtx[]> {
  const out = new Map<PlayerId, PreflopActionCtx[]>();
  let raises = 0;
  let maxBet = c.bb;
  for (const h of c.history) {
    if (h.street !== 'preflop') continue;
    const p = c.view.players.find((x) => x.id === h.playerId);
    if (!p) continue;
    const idx = c.order.indexOf(h.playerId);
    const amount = h.amount ?? (h.type === 'raise' || h.type === 'bet' ? maxBet * 3 : maxBet);
    const aggressive = h.type === 'raise' || h.type === 'bet' || (h.type === 'allin' && amount > maxBet);
    const ctx: PreflopActionCtx = {
      type: h.type === 'allin' && !aggressive ? 'call' : h.type,
      raisesBefore: raises,
      behind: Math.max(0, c.order.length - 1 - idx),
      isBigBlind: p.isBigBlind,
      isSmallBlind: p.isSmallBlind,
      stackBB: (p.stack + p.committed) / c.bb,
      toBB: amount / c.bb,
    };
    if (aggressive) {
      raises++;
      maxBet = Math.max(maxBet, amount);
    }
    if (!out.has(h.playerId)) out.set(h.playerId, []);
    out.get(h.playerId)!.push(ctx);
  }
  return out;
}

function rangeOf(c: Ctx, p: PlayerView, pre: Map<PlayerId, PreflopActionCtx[]>, floor = PREFLOP_FLOOR): Range {
  const reads = readsOf(c, p.id);
  const widen = (ctx: PreflopActionCtx) => (ctx.type === 'call' || ctx.type === 'check' ? reads.widenCall : reads.widenRaise);
  const r = removeCards(fullRange(), [...c.hero, ...c.board]);
  for (const ctx of pre.get(p.id) ?? []) shapeByPct(r, preflopActionWeight(ctx, widen(ctx)), floor);
  for (const h of c.history) {
    if (h.playerId !== p.id || h.street === 'preflop') continue;
    applyPostflopAction(r, c.board.slice(0, BOARD_LEN[h.street]), h.type, reads.softness, !!TUNE.later);
  }
  // keep something sensible if the player did something our model considers impossible
  if (totalWeight(r) < 0.5) {
    const fresh = removeCards(fullRange(), [...c.hero, ...c.board]);
    for (const ctx of pre.get(p.id) ?? []) shapeByPct(fresh, preflopActionWeight(ctx, widen(ctx)));
    return fresh;
  }
  return r;
}

// ───────────── opponent response to a bet ─────────────

interface Response {
  fold: number;
  callRange: Range;
}

/**
 * How an opponent reacts to a bet of `b` × pot: strong hands always continue,
 * draws mostly, the rest defends roughly the minimum-defence frequency of
 * their own range, best hands first.
 */
function respond(r: Range, buckets: Uint8Array, order: Int32Array, b: number, river: boolean, defence: number): Response {
  const total = totalWeight(r);
  const call = new Float32Array(COMBO_COUNT);
  if (total <= 0) return { fold: 0, callRange: call };
  // people call more than the theoretical minimum defence frequency
  const mdf = Math.min(1, defence / (1 + b));
  let cont = 0;
  for (let k = 0; k < COMBO_COUNT; k++) {
    if (r[k] <= 0) continue;
    const bk = buckets[k];
    if (bk === Bucket.Monster || bk === Bucket.Strong) call[k] = r[k];
    else if (!river && bk === Bucket.Draw) call[k] = r[k] * (b <= 0.75 ? 0.85 : 0.55);
    cont += call[k];
  }
  let need = mdf * total - cont;
  for (let i = 0; i < COMBO_COUNT && need > 0; i++) {
    const k = order[i];
    const rest = r[k] - call[k];
    if (rest <= 0) continue;
    const take = Math.min(rest, need);
    call[k] += take;
    need -= take;
    cont += take;
  }
  return { fold: Math.max(0, 1 - cont / total), callRange: call };
}

// ───────────── choosing ─────────────

interface Candidate {
  action: PlayerAction;
  ev: number;
}

function pick(cands: Candidate[], temperature: number, rng: RngState): PlayerAction {
  const best = Math.max(...cands.map((c) => c.ev));
  const t = Math.max(temperature, 1e-6);
  const w = cands.map((c) => Math.exp((c.ev - best) / t));
  const sum = w.reduce((a, b) => a + b, 0);
  let x = nextFloat(rng) * sum;
  for (let i = 0; i < cands.length; i++) {
    x -= w[i];
    if (x <= 0) return cands[i].action;
  }
  return cands[cands.length - 1].action;
}

const roundTo = (v: number, unit: number) => Math.round(v / unit) * unit;

/** Tournament survival: putting a large share of the stack at risk needs a margin. */
function riskAdjust(cands: Candidate[], me: PlayerView, callAmount: number) {
  if (!TUNE.risk) return;
  const stack = me.stack + me.bet;
  for (const c of cands) {
    const invest = c.action.type === 'raise' ? c.action.amount - me.bet : c.action.type === 'call' ? callAmount : 0;
    const share = invest / Math.max(1, stack);
    if (share > 0.25) c.ev -= TUNE.risk * invest * share;
  }
}

function raiseAction(view: TableView, to: number): PlayerAction {
  const l = view.legal!;
  const unit = Math.max(1, Math.min(view.level.sb, 25));
  let amt = Math.max(l.minRaiseTo, Math.min(l.maxRaiseTo, roundTo(to, unit)));
  if (amt >= l.maxRaiseTo * 0.75) amt = l.maxRaiseTo; // commit instead of leaving crumbs
  return { type: 'raise', amount: amt };
}

const passive = (view: TableView): PlayerAction => (view.legal!.canCheck ? { type: 'check' } : { type: 'call' });

// ───────────── pre-flop ─────────────

function preflop(c: Ctx): BotDecision {
  const { view, me, hero, bb, rng } = c;
  const l = view.legal!;
  const pct = handPct(hero[0], hero[1]);
  const pre = preflopContexts(c);
  const aggressors = c.history.filter((h) => h.street === 'preflop' && h.type !== 'fold' && h.type !== 'check' && h.type !== 'call');
  const raises = [...pre.values()].flat().filter((x) => x.type === 'raise' || x.type === 'bet' || x.type === 'allin').length;
  const behindPlayers = c.opponents.filter((o) => !o.allIn && !c.history.some((h) => h.playerId === o.id && h.street === 'preflop'));
  const behind = behindPlayers.length;
  const oppMax = Math.max(...c.opponents.map((o) => o.stack + o.bet), 0);
  const effBB = Math.min(me.stack + me.bet, oppMax) / bb;
  const myStackBB = (me.stack + me.bet) / bb;
  const P = c.pot;
  const C = l.callAmount;
  const fold: PlayerAction = l.canCheck ? { type: 'check' } : { type: 'fold' };
  const decision = (action: PlayerAction, equity = 0): BotDecision => ({ action, equity });
  const inPosition = behind === 0 || (behind === 1 && behindPlayers[0]?.isBigBlind && !me.isSmallBlind);

  // ── short stack, unopened: shove or fold by EV ──
  if (raises === 0 && effBB <= TUNE.pushBB && l.canRaise) {
    const shoveBB = Math.min(myStackBB, effBB);
    const cp = callShovePct(shoveBB);
    const pAllFold = behindPlayers.reduce((a) => a * (1 - cp), 1);
    const callerRange = removeCards(fullRange(), hero);
    shapeByPct(callerRange, (p) => (p <= cp ? 1 : 0));
    const eq = equityVs(hero, [], [callerRange], Math.round(c.budget * 0.6), rng);
    const risk = l.maxRaiseTo - me.bet;
    const evShove = pAllFold * P + (1 - pAllFold) * (eq * (P + risk + Math.min(risk, oppMax)) - risk);
    const evOther = l.canCheck ? eq * P * 0.8 : 0;
    const cands: Candidate[] = [
      { action: { type: 'raise', amount: l.maxRaiseTo }, ev: evShove },
      { action: fold, ev: evOther },
    ];
    riskAdjust(cands, me, view.legal!.callAmount);
    return decision(pick(cands, 0.15 * bb, rng), eq);
  }

  // ── facing a raise ──
  if (raises >= 1 && C > 0) {
    const last = aggressors[aggressors.length - 1];
    const raiser = c.opponents.find((o) => o.id === last?.playerId) ?? c.opponents[0];
    // an all-in rarely comes from trash – don't let the "anything is possible" floor flatter our calls
    const shoveFacing = raiser.allIn || C >= 0.6 * me.stack;
    const rRange = rangeOf(c, raiser, pre, TUNE.strictShove && shoveFacing ? 0.02 : PREFLOP_FLOOR);
    const eq = equityVs(hero, [], [rRange], Math.round(c.budget * 0.7), rng);
    const R = C >= me.stack ? 1 : inPosition ? 0.95 : 0.85;
    const evCall = R * eq * (P + C) - C;
    const cands: Candidate[] = [{ action: fold, ev: 0 }, { action: { type: 'call' }, ev: evCall }];

    const shortOrAllIn = raiser.allIn || effBB <= TUNE.reshoveBB || C >= 0.35 * me.stack;
    if (l.canRaise && shortOrAllIn) {
      // re-shove: some of the raiser's range folds unless he is all-in
      const jamBB = myStackBB;
      const callTop = raiser.allIn ? 1 : callShovePct(jamBB) * 0.7;
      const callers = new Float32Array(rRange);
      for (let k = 0; k < COMBO_COUNT; k++) if (COMBO_PCT[k] > callTop) callers[k] *= raiser.allIn ? 1 : 0.15;
      const f = raiser.allIn ? 0 : 1 - totalWeight(callers) / Math.max(1e-9, totalWeight(rRange));
      const eqC = raiser.allIn ? eq : equityVs(hero, [], [callers], Math.round(c.budget * 0.4), rng);
      const risk = l.maxRaiseTo - me.bet;
      const evJam = f * P + (1 - f) * (eqC * (P + risk + Math.min(risk, raiser.stack + raiser.bet - me.bet)) - risk);
      cands.push({ action: { type: 'raise', amount: l.maxRaiseTo }, ev: evJam });
    } else if (l.canRaise) {
      // deep: value 3-/4-bets from the top of the range, a few bluffs from suited hands in position
      const suited = (hero[0] & 3) === (hero[1] & 3);
      // re-raise wider against players who raise a lot (their range is weak)
      const loose = TUNE.adapt ? clamp(readsOf(c, raiser.id).widenRaise, 1, 3) : 1;
      const valueTop = (raises === 1 ? (inPosition ? 0.06 : 0.045) : raises === 2 ? 0.022 : 0.012) * loose;
      const bluff = raises === 1 && suited && pct > 0.1 && pct < 0.24 && inPosition && nextFloat(rng) < 0.22;
      if (pct <= valueTop || bluff) {
        const to = raises === 1 ? view.currentBet * (inPosition ? 3 : 3.6) : view.currentBet * 2.3;
        const action = to >= (me.stack + me.bet) * 0.4 ? { type: 'raise' as const, amount: l.maxRaiseTo } : raiseAction(view, to);
        return decision(action, eq);
      }
    }
    riskAdjust(cands, me, view.legal!.callAmount);
    return decision(pick(cands, 0.08 * bb, rng), eq);
  }

  // ── unopened (or limped) pot, deep enough to play poker ──
  const limpers = c.history.filter((h) => h.street === 'preflop' && h.type === 'call').length;
  if (l.canCheck) {
    // big blind with the option
    if (l.canRaise && pct <= (limpers ? 0.12 : 0.2)) return decision(raiseAction(view, bb * (3 + limpers)), 0);
    return decision({ type: 'check' }, 0);
  }
  // steal more when the players behind rarely defend, less against loose callers
  const vpipBehind = behindPlayers.length
    ? behindPlayers.reduce((a, o) => a + tendencies(c.stats?.[o.id]).vpip, 0) / behindPlayers.length
    : DEFAULT_TENDENCIES.vpip;
  const steal = TUNE.adapt ? clamp(DEFAULT_TENDENCIES.vpip / vpipBehind, 0.75, 1.8) : 1;
  let top = Math.min(0.85, openPct(behind) * steal) * (limpers ? 0.7 : 1) * (me.isSmallBlind && behind === 1 ? 1.15 : 1);
  if (me.isSmallBlind && behind === 1) top = Math.max(top, TUNE.huOpen && c.opponents.length === 1 ? 0.62 : 0.45);
  const edge = 0.03;
  const pOpen = pct <= top - edge ? 1 : pct >= top + edge ? 0 : (top + edge - pct) / (2 * edge);
  if (l.canRaise && nextFloat(rng) < pOpen) {
    const size = me.isSmallBlind && behind === 1 ? 3 : behind <= 2 ? 2.3 : 2.5;
    return decision(raiseAction(view, bb * (size + limpers)), 0);
  }
  // completing the small blind with playable hands is fine when only the big blind is left
  if (me.isSmallBlind && behind === 1 && limpers === 0 && pct <= 0.7 && C <= bb) return decision({ type: 'call' }, 0);
  return decision(fold, 0);
}

// ───────────── post-flop ─────────────

function postflop(c: Ctx): BotDecision {
  const { view, me, hero, board, rng, bb } = c;
  const l = view.legal!;
  const river = board.length >= 5;
  const pre = preflopContexts(c);
  const live = c.opponents.filter((o) => !o.folded);
  const ranges = live.map((o) => rangeOf(c, o, pre));
  const P = c.pot;
  const C = l.callAmount;
  const eqNow = equityVs(hero, board, ranges, Math.round(c.budget * 0.35), rng);
  const n = view.players.length;
  const btn = view.players.find((p) => p.isButton)?.seat ?? 0;
  const dist = (s: number) => (s - btn - 1 + n) % n;
  const inPosition = live.every((o) => dist(o.seat) < dist(me.seat));
  const R = river ? 1 : (inPosition ? 1 : TUNE.oop) * (live.length > 1 ? 0.95 : 1);
  const mine = classify(hero, board);

  // hand strength order on this board (for the opponents' continue decisions)
  const buckets = bucketsOn(board);
  const strength = new Float64Array(COMBO_COUNT);
  const cards = new Int32Array(7);
  for (let i = 0; i < board.length; i++) cards[2 + i] = board[i];
  for (let k = 0; k < COMBO_COUNT; k++) {
    cards[0] = COMBO_A[k];
    cards[1] = COMBO_B[k];
    strength[k] = evaluate(cards, 2 + board.length);
  }
  const order = Int32Array.from({ length: COMBO_COUNT }, (_, i) => i).sort((a, b) => strength[b] - strength[a]);

  const cands: Candidate[] = [];
  const implied = !river && mine.draw >= 2 ? 0.08 * Math.min(P, me.stack) : 0;
  // who took the betting lead on the previous streets?
  const lastAggr = [...c.history].reverse().find((h) => h.street !== view.street && (h.type === 'bet' || h.type === 'raise' || h.type === 'allin'));
  const initiative = lastAggr?.playerId === me.id;
  const firstToAct = !c.history.some((h) => h.street === view.street);
  const checkBonus = !initiative && !inPosition && firstToAct ? TUNE.donk * P : 0;
  if (l.canCheck) cands.push({ action: { type: 'check' }, ev: R * eqNow * P + checkBonus });
  else {
    cands.push({ action: { type: 'fold' }, ev: 0 });
    const allInCall = C >= me.stack;
    cands.push({ action: { type: 'call' }, ev: (allInCall ? 1 : R) * eqNow * (P + C) - C + (allInCall ? 0 : implied) });
  }

  if (l.canRaise) {
    const targets = new Set<number>();
    if (TUNE.fixedSizes) {
      // one size per street for every hand: the size tells the opponent nothing
      const frac = board.length === 3 ? 0.45 : board.length === 4 ? 0.66 : 0.75;
      if (C === 0) targets.add(frac * P);
      else targets.add(TUNE.raiseX ? TUNE.raiseX * view.currentBet : view.currentBet + 0.9 * (P + C));
    } else if (C === 0) for (const f of [0.33, 0.66, 1]) targets.add(f * P);
    else for (const f of [0.75, 1.1]) targets.add(view.currentBet + f * (P + C));
    targets.add(l.maxRaiseTo);
    const seen = new Set<number>();
    const rangesFor = live.map((o, i) => ({ o, r: ranges[i] }));
    let evals = 0;
    for (const target of targets) {
      const action = raiseAction(view, target) as { type: 'raise'; amount: number };
      if (seen.has(action.amount)) continue;
      seen.add(action.amount);
      const invest = action.amount - me.bet;
      const b = invest / Math.max(1, P);
      let fAll = 1;
      let callersSum = 0;
      let callAmtSum = 0;
      const callRanges: Range[] = [];
      for (const { o, r } of rangesFor) {
        if (o.allIn) {
          // cannot fold any more – they are in for what they have
          callRanges.push(r);
          continue;
        }
        const resp = respond(r, buckets, order, b, river, readsOf(c, o.id).defence);
        fAll *= resp.fold;
        callersSum += 1 - resp.fold;
        callAmtSum += Math.min(action.amount - o.bet, o.stack);
        callRanges.push(resp.callRange);
      }
      const live2 = rangesFor.filter(({ o }) => !o.allIn).length;
      const pCalled = 1 - fAll;
      const eqCalled = pCalled > 0.001 ? equityVs(hero, board, callRanges, Math.round(c.budget * 0.16), rng) : eqNow;
      evals++;
      const k = pCalled > 0 ? Math.max(1, callersSum / pCalled) : 0;
      const avgCall = live2 ? callAmtSum / live2 : 0;
      const potCalled = P + invest + k * avgCall;
      const allIn = action.amount >= l.maxRaiseTo;
      const ev = fAll * P + pCalled * ((allIn ? 1 : R) * eqCalled * potCalled - invest);
      cands.push({ action, ev });
      if (evals >= 4) break;
    }
  }

  riskAdjust(cands, me, view.legal!.callAmount);
  const action = pick(cands, TUNE.temp * P + 0.25 * bb, rng);
  return { action: action.type === 'raise' || action.type === 'fold' ? action : passive(view), equity: eqNow };
}

export function decideExpert(input: BotInput): BotDecision {
  const { view, history } = input;
  const me = view.players.find((p) => p.id === view.viewerId);
  if (!view.legal || !me) throw new Error('Bot asked to act out of turn');
  const hero = me.holeCards.filter((x): x is number => x !== null);
  const c: Ctx = {
    view,
    me,
    hero,
    board: view.board,
    bb: view.level.bb,
    pot: view.potTotal,
    history,
    rng: seedRng(input.seed),
    opponents: view.players.filter((p) => p.id !== me.id && !p.folded && !p.eliminated),
    order: preflopOrder(view),
    budget: input.profile.iterations,
    stats: input.stats,
  };
  return view.street === 'preflop' ? preflop(c) : postflop(c);
}
