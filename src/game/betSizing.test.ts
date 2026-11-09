import { describe, expect, it } from 'vitest';
import { snapRaiseTo } from './betSizing';

describe('snapRaiseTo', () => {
  it('keeps the exact stack for an all-in that is not a multiple of the unit', () => {
    expect(snapRaiseTo(1230, 25, 100, 1230)).toBe(1230);
    expect(snapRaiseTo(5000, 25, 100, 1230)).toBe(1230);
  });

  it('turns amounts that would leave less than one unit into an all-in', () => {
    expect(snapRaiseTo(1225, 25, 100, 1230)).toBe(1230);
    expect(snapRaiseTo(1220, 25, 100, 1230)).toBe(1230);
    expect(snapRaiseTo(1200, 25, 100, 1230)).toBe(1200);
  });

  it('rounds normal amounts to the unit and respects the minimum', () => {
    expect(snapRaiseTo(512, 25, 100, 1230)).toBe(500);
    expect(snapRaiseTo(90, 25, 105, 1230)).toBe(105);
    expect(snapRaiseTo(110, 25, 105, 1230)).toBe(105);
  });
});
