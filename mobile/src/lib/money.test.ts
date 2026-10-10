import { formatCents, formatMultiplier, formatReward } from './money';

describe('money', () => {
  it.each([
    [0, '$0.00'],
    [1, '$0.01'],
    [52, '$0.52'],
    [1300, '$13.00'],
    [123456, '$1,234.56'],
    [-850, '-$8.50'],
  ])('formatCents(%i) -> %s', (cents, expected) => expect(formatCents(cents)).toBe(expected));

  it('formats rewards with a plus sign', () => {
    expect(formatReward(52)).toBe('+$0.52');
    expect(formatReward(0)).toBe('+$0.00');
  });

  it.each([
    [4, '4x'],
    [1.5, '1.5x'],
    [3, '3x'],
    [2.25, '2.25x'],
  ])('formatMultiplier(%d) -> %s', (m, expected) => expect(formatMultiplier(m)).toBe(expected));

  it('rejects non-integer cents', () => {
    expect(() => formatCents(1.5)).toThrow('cents must be an integer');
  });
});
