import { describe, expect, it } from 'vitest';
import { parseCards } from './cards';
import { categoryOf, describeHand, evaluate, HandCategory } from './evaluator';

const ev = (s: string) => evaluate(parseCards(s));
const cat = (s: string) => categoryOf(ev(s));

describe('evaluator categories', () => {
  it.each([
    ['As Ks Qs Js Ts 2d 3c', HandCategory.StraightFlush],
    ['5h 4h 3h 2h Ah Kd Kc', HandCategory.StraightFlush],
    ['9c 9d 9h 9s 2d 3c 4h', HandCategory.Quads],
    ['9c 9d 9h 2s 2d 3c 4h', HandCategory.FullHouse],
    ['9c 9d 9h 2s 2d 2c 4h', HandCategory.FullHouse],
    ['Ac 9c 7c 4c 2c Kd Kh', HandCategory.Flush],
    ['9c 8d 7h 6s 5d 2c 2h', HandCategory.Straight],
    ['Ac 2d 3h 4s 5d Kc Kh', HandCategory.Straight],
    ['9c 9d 9h As 2d 3c 4h', HandCategory.Trips],
    ['9c 9d 8h 8s 2d 2c 4h', HandCategory.TwoPair],
    ['9c 9d 8h 7s 2d 3c 4h', HandCategory.Pair],
    ['Ac Jd 8h 7s 2d 3c 4h', HandCategory.HighCard],
  ])('%s → %i', (hand, expected) => {
    expect(cat(hand)).toBe(expected);
  });
});

describe('evaluator ordering', () => {
  it('ranks higher categories above lower ones', () => {
    expect(ev('2c 3d 4h 5s 6d')).toBeGreaterThan(ev('Ac Ad Ah Ks Qd'));
    expect(ev('Ac Ad Ah Ks Kd')).toBeGreaterThan(ev('Ac Kc Qc Jc 9c'));
  });
  it('wheel is the lowest straight', () => {
    expect(ev('2c 3d 4h 5s 6d')).toBeGreaterThan(ev('Ac 2d 3h 4s 5d'));
  });
  it('compares kickers', () => {
    expect(ev('Ac Ad Kh 7s 2d')).toBeGreaterThan(ev('Ac Ad Qh 7s 2d'));
    expect(ev('Ac Ad Kh 7s 3d')).toBeGreaterThan(ev('As Ah Kd 7c 2h'));
    expect(ev('Kc Kd 5h 5s Ad')).toBeGreaterThan(ev('Kh Ks 5c 5d Qd'));
  });
  it('detects ties', () => {
    expect(ev('Ac Kd Qh Js 9d 2c 3c')).toBe(ev('Ad Kc Qs Jh 9c 2d 3d'));
  });
  it('chooses best two pair from three pairs', () => {
    expect(ev('Ac Ad Kh Ks 2d 2c 3h')).toBe(ev('Ac Ad Kh Ks 3d'));
  });
  it('full house uses the higher trips', () => {
    expect(ev('9c 9d 9h 8s 8d 8c 2h')).toBe(ev('9c 9d 9h 8s 8d 4c 2h'));
  });
  it('flush beats straight in the same 7 cards', () => {
    expect(cat('9h 8h 7h 6s 5h 2h Kd')).toBe(HandCategory.Flush);
  });
});

describe('describeHand', () => {
  it('returns the best five cards', () => {
    const d = describeHand(parseCards('Ah Kh Qh Jh Th 9h 2c'));
    expect(d.key).toBe('straightFlush');
    expect(d.best).toHaveLength(5);
    expect(d.score).toBe(ev('Ah Kh Qh Jh Th 9h 2c'));
  });
});
