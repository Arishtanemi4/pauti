import { describe, expect, it } from 'vitest';
import { formatMinorUnits, parseToMinorUnits } from './format';

describe('formatMinorUnits', () => {
  it('formats a 2-decimal currency from minor units', () => {
    expect(formatMinorUnits(150099, 'INR', 'en-IN')).toBe('₹1,500.99');
  });

  it('formats a 0-decimal currency (JPY has no minor unit) without dividing by 100', () => {
    expect(formatMinorUnits(1500, 'JPY', 'en-US')).toBe('¥1,500');
  });
});

describe('parseToMinorUnits', () => {
  it('parses a 2-decimal amount into minor units', () => {
    expect(parseToMinorUnits('1500.99', 'INR')).toBe(150099);
  });

  it('parses a 0-decimal currency without multiplying by 100', () => {
    expect(parseToMinorUnits('1500', 'JPY')).toBe(1500);
  });

  it('round-trips through formatMinorUnits', () => {
    expect(parseToMinorUnits('12.50', 'USD')).toBe(1250);
  });

  it('throws on non-numeric input', () => {
    expect(() => parseToMinorUnits('abc', 'INR')).toThrow('Invalid amount');
  });
});
