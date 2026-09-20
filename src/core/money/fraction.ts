// Exact rational arithmetic. Splitting logic must never fall back to floating-point
// decimals (0.3333...) for shares — see docs/plan/EXECUTE.md Phase 1.2.

export interface Fraction {
  readonly num: number;
  readonly den: number;
}

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

export function fraction(num: number, den: number): Fraction {
  if (den === 0) {
    throw new Error('Fraction denominator cannot be zero');
  }
  if (den < 0) {
    num = -num;
    den = -den;
  }
  const divisor = gcd(num, den) || 1;
  return { num: num / divisor, den: den / divisor };
}

export const ZERO: Fraction = { num: 0, den: 1 };
export const ONE: Fraction = { num: 1, den: 1 };

export function addFractions(a: Fraction, b: Fraction): Fraction {
  return fraction(a.num * b.den + b.num * a.den, a.den * b.den);
}

export function compareFractions(a: Fraction, b: Fraction): number {
  return a.num * b.den - b.num * a.den;
}

export function fractionToNumber(f: Fraction): number {
  return f.num / f.den;
}
