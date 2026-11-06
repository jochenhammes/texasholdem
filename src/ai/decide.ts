import type { PlayerAction, PlayerId, Street } from '../engine/types';
import { nextFloat, seedRng, type RngState } from '../engine/rng';
import type { TableView } from '../engine/view';
import { monteCarloEquity } from './equity';
import type { BotProfile } from './profiles';

/** Compact record of what happened in the current hand (fed by the controller). */
export interface HandAction {
  playerId: PlayerId;
  street: Street;
  type: 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';
}

export interface BotInput {
  view: TableView;
  profile: BotProfile;
  history: HandAction[];
  seed: number;
}

export interface BotDecision {
  action: PlayerAction;
  /** Debug info (equity etc.) – handy when tuning the bots. */
  equity: number;
}

function gaussian(rng: RngState): number {
  const u = Math.max(1e-9, nextFloat(rng));
  const v = nextFloat(rng);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Assumed minimum Chen score for an opponent, based on what they did this hand.
 * Raisers hold stronger hands than callers, callers stronger than random.
 */
function opponentRange(id: PlayerId, history: HandAction[], awareness: number): number {
  if (awareness <= 0) return -10;
  let min = -10;
  const pre = history.filter((h) => h.playerId === id && h.street === 'preflop');
  const raisedPre = pre.some((h) => h.type === 'raise' || h.type === 'bet' || h.type === 'allin');
  const calledPre = pre.some((h) => h.type === 'call');
  if (raisedPre) min = 6 + Math.round(2 * awareness);
  else if (calledPre) min = 3 + Math.round(2 * awareness);
  return min;
}

export function decide(input: BotInput): BotDecision {
  const { view, profile, history } = input;
  const rng = seedRng(input.seed);
  const legal = view.legal;
  const me = view.players.find((p) => p.id === view.viewerId);
  if (!legal || !me) throw new Error('Bot asked to act out of turn');

  const hero = me.holeCards.filter((c): c is number => c !== null);
  const bb = view.level.bb;
  const unit = Math.max(1, Math.min(view.level.sb, 25));
  const preflop = view.street === 'preflop';
  const toCall = legal.callAmount;
  const pot = view.potTotal;
  const stackBB = (me.stack + me.bet) / bb;
  const check = (): PlayerAction => (legal.canCheck ? { type: 'check' } : { type: 'fold' });
  const call = (): PlayerAction => (legal.canCheck ? { type: 'check' } : { type: 'call' });
  const allIn = (): PlayerAction =>
    legal.canRaise ? { type: 'raise', amount: legal.maxRaiseTo } : toCall > 0 ? { type: 'call' } : { type: 'check' };

  const raiseTo = (target: number): PlayerAction => {
    if (!legal.canRaise) return call();
    let to = Math.round(target / unit) * unit;
    to = Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, to));
    // when most of the stack would go in anyway, just shove
    if (to >= legal.maxRaiseTo * 0.7) to = legal.maxRaiseTo;
    return { type: 'raise', amount: to };
  };

  // ── opponents & their ranges ──
  const opponents = view.players.filter((p) => p.id !== me.id && !p.folded && !p.eliminated);
  let simOpps: number[];
  if (preflop) {
    // Players who haven't put money in voluntarily will usually fold: count them partially.
    const voluntary = opponents.filter((o) => history.some((h) => h.playerId === o.id && h.street === 'preflop' && h.type !== 'fold' && h.type !== 'check'));
    const passive = opponents.length - voluntary.length;
    const effective = Math.max(1, Math.min(opponents.length, Math.round(voluntary.length + passive * 0.3)));
    const ranges = voluntary.map((o) => opponentRange(o.id, history, profile.rangeAwareness));
    while (ranges.length < effective) ranges.push(profile.rangeAwareness > 0 ? 2 : -10);
    simOpps = ranges.slice(0, effective);
  } else {
    simOpps = opponents.map((o) => opponentRange(o.id, history, profile.rangeAwareness));
  }

  let equity = monteCarloEquity({ hero, board: view.board, opponentMinChen: simOpps, iterations: profile.iterations }, rng);

  // Post-flop aggression from opponents on this street usually means strength.
  if (!preflop) {
    const aggressors = history.filter(
      (h) => h.street === view.street && h.playerId !== me.id && (h.type === 'bet' || h.type === 'raise' || h.type === 'allin'),
    ).length;
    equity *= Math.pow(1 - 0.1 * profile.rangeAwareness, aggressors);
  }
  const trueEquity = equity;
  equity = Math.min(1, Math.max(0, equity + gaussian(rng) * profile.noise));

  const nSim = simOpps.length;
  const fair = 1 / (nSim + 1);
  const strength = (equity - fair) / (1 - fair); // 0 = average, 1 = lock
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const strongT = 0.22 + profile.tightness;
  const monsterT = 0.55 + profile.tightness / 2;
  const r = () => nextFloat(rng);
  // In position = acting last post-flop (closest seat to the button, clockwise).
  const buttonSeat = view.players.find((p) => p.isButton)?.seat ?? 0;
  const n = view.players.length;
  const distFromButton = (seat: number) => (seat - buttonSeat - 1 + n) % n;
  const inPosition = opponents.every((o) => distFromButton(o.seat) < distFromButton(me.seat));
  const decision = (action: PlayerAction): BotDecision => ({ action, equity: trueEquity });

  // ── short stack: push or fold ──
  if (preflop && profile.pushFold && stackBB <= 11) {
    const facingRaise = view.currentBet > bb;
    if (!facingRaise) {
      const threshold = 0.2 * (stackBB / 11) - 0.05 + profile.tightness;
      if (strength > threshold) return decision(allIn());
      return decision(check());
    }
    if (equity >= potOdds + 0.03 + profile.tightness / 2 || strength > 0.25) return decision(allIn());
    return decision(check());
  }

  // ── nothing to call ──
  if (toCall === 0) {
    if (strength > monsterT && !preflop && r() < profile.slowplay) return decision(check());
    if (strength > strongT && r() < profile.aggression) {
      if (preflop) return decision(raiseTo(bb * (2.5 + r())));
      const f = strength > monsterT ? 0.66 + r() * 0.4 : 0.45 + r() * 0.3;
      return decision(raiseTo(pot * f));
    }
    const bluffChance = profile.bluff * (nSim === 1 ? 1.2 : 0.5) * (preflop ? 0.5 : 1) * (inPosition ? 1.4 : 1);
    if (r() < bluffChance) return decision(raiseTo(preflop ? bb * 2.5 : pot * (0.4 + r() * 0.25)));
    return decision(check());
  }

  // ── facing a bet ──
  const raiseSize = (f: number) =>
    preflop ? view.currentBet * (2.6 + r() * 0.8) + (pot - view.currentBet) * 0.3 : view.currentBet + (pot + toCall) * f;
  if (strength > monsterT) {
    if (r() < profile.aggression * (preflop ? 1 : 1 - profile.slowplay)) return decision(raiseTo(raiseSize(0.7 + r() * 0.4)));
    return decision(call());
  }
  if (strength > strongT + 0.1 && r() < profile.aggression * 0.45) return decision(raiseTo(raiseSize(0.6 + r() * 0.3)));

  // Cheap pre-flop calls get some implied-odds credit.
  const implied = preflop && toCall <= me.stack * 0.06 ? 0.05 : 0;
  const bigBet = toCall > (me.stack + me.bet) * 0.45;
  // Every opponent still to act behind us can wake up with a hand.
  const behind = opponents.filter(
    (o) => !o.allIn && !history.some((h) => h.playerId === o.id && h.street === view.street),
  ).length;
  const needed =
    potOdds + profile.callMargin - implied + behind * 0.03 + (bigBet ? 0.06 + profile.tightness : 0);
  if (equity >= needed) return decision(call());
  if (!preflop && r() < profile.bluff * 0.35 && nSim === 1) return decision(raiseTo(raiseSize(0.6)));
  return decision(check());
}

export function decideWithFallback(input: BotInput): PlayerAction {
  try {
    return decide(input).action;
  } catch {
    const l = input.view.legal;
    return l?.canCheck ? { type: 'check' } : { type: 'fold' };
  }
}
