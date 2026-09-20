import { describe, expect, it } from 'vitest';
import { formatMinorUnits } from './format';

describe('formatMinorUnits', () => {
  it('formats a 2-decimal currency from minor units', () => {
    expect(formatMinorUnits(150099, 'INR', 'en-IN')).toBe('₹1,500.99');
  });

  it('formats a 0-decimal currency (JPY has no minor unit) without dividing by 100', () => {
    expect(formatMinorUnits(1500, 'JPY', 'en-US')).toBe('¥1,500');
  });
});
