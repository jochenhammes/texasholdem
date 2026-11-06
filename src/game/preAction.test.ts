import { describe, expect, it } from 'vitest';
import { applyAction, createTournament, legalActions, startHand } from '../engine/engine';
import { toView } from '../engine/view';
import { isStillValid, projectedLegal, resolvePreAction, type QueuedPreAction } from './preAction';

function setup() {
  const s = createTournament(
    { startingStack: 1000, handsPerLevel: 100, levels: [{ sb: 10, bb: 20, ante: 0 }] },
    [
      { id: 'hero', name: 'H', kind: 'human' },
      { id: 'a', name: 'A', kind: 'bot' },
      { id: 'b', name: 'B', kind: 'bot' },
      { id: 'c', name: 'C', kind: 'bot' },
    ],
    1,
  );
  s.buttonSeat = 0; // hero on the button: a = SB, b = BB, c = UTG acts first
  startHand(s);
  return s;
}

describe('pre-actions', () => {
  it('projects the legal actions while waiting', () => {
    const s = setup();
    const l = projectedLegal(toView(s, 'hero'), 'hero')!;
    expect(l.callAmount).toBe(20);
    expect(l.minRaiseTo).toBe(40);
    expect(l.canRaise).toBe(true);
    // projection matches what the engine offers once it's the hero's turn
    applyAction(s, 'c', { type: 'call' });
    expect(projectedLegal(toView(s, 'hero'), 'hero')).toBeNull();
    const real = legalActions(s, 0)!;
    expect(real.minRaiseTo).toBe(40);
    expect(real.callAmount).toBe(20);
  });

  it('is not offered when we already matched the bet', () => {
    const s = setup();
    applyAction(s, 'c', { type: 'call' });
    applyAction(s, 'hero', { type: 'call' });
    expect(projectedLegal(toView(s, 'hero'), 'hero')).toBeNull();
    applyAction(s, 'a', { type: 'raise', amount: 100 });
    // a raise behind us brings the decision back
    expect(projectedLegal(toView(s, 'hero'), 'hero')).not.toBeNull();
  });

  it('a fixed call is voided by a raise, call any is not', () => {
    const s = setup();
    const v = toView(s, 'hero');
    const call: QueuedPreAction = { action: { type: 'call', level: 20, amount: 20 }, hand: v.handNumber, street: v.street };
    const any: QueuedPreAction = { action: { type: 'callAny' }, hand: v.handNumber, street: v.street };
    applyAction(s, 'c', { type: 'raise', amount: 60 });
    const v2 = toView(s, 'hero');
    expect(isStillValid(call, v2, 'hero')).toBe(false);
    expect(isStillValid(any, v2, 'hero')).toBe(true);
    expect(resolvePreAction(any.action, v2.legal!)).toEqual({ type: 'call' });
    expect(resolvePreAction(call.action, v2.legal!)).toBeNull();
  });

  it('check/fold checks when free and folds to a bet', () => {
    const s = setup();
    const legal = legalActions(s, s.toAct)!;
    expect(resolvePreAction({ type: 'checkFold' }, legal)).toEqual({ type: 'fold' });
    expect(resolvePreAction({ type: 'checkFold' }, { ...legal, canCheck: true, callAmount: 0 })).toEqual({ type: 'check' });
  });

  it('raise is clamped to the legal range and voided when the bet changes', () => {
    const s = setup();
    applyAction(s, 'c', { type: 'call' });
    const legal = toView(s, 'hero').legal!;
    expect(resolvePreAction({ type: 'raise', level: 20, to: 5000 }, legal)).toEqual({ type: 'raise', amount: 1000 });
    expect(resolvePreAction({ type: 'raise', level: 20, to: 10 }, legal)).toEqual({ type: 'raise', amount: 40 });
    expect(resolvePreAction({ type: 'raise', level: 40, to: 100 }, legal)).toBeNull();
  });
});
