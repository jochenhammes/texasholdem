import { describe, expect, it } from 'vitest';
import { chipsFor } from './pokerTable';
import { DENOMS } from './textures';

describe('chipsFor', () => {
  it('splits every amount exactly into chips', () => {
    for (const amount of [5, 20, 35, 150, 1480, 1500, 2995, 9000, 40000]) {
      const counts = chipsFor(amount);
      expect(counts.reduce((sum, n, i) => sum + n * DENOMS[i].value, 0)).toBe(amount);
    }
  });

  it('keeps some small change instead of only the biggest chips', () => {
    const counts = chipsFor(1500);
    expect(counts[0] + counts[1]).toBeGreaterThan(0);
  });
});
