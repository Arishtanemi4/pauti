import { describe, expect, it } from 'vitest';
import { distributeByWeight, distributeEqually } from './distribute';
import { mulberry32, randomInt } from '../testing/prng';

describe('distributeByWeight', () => {
  it('splits an equal 3-way division with a stable remainder rule (34/33/33)', () => {
    const result = distributeEqually(100, ['a', 'b', 'c']);
    const values = Object.values(result).sort((x, y) => y - x);
    expect(values).toEqual([34, 33, 33]);
    // Lexicographically-first id absorbs the remainder unit.
    expect(result.a).toBe(34);
  });

  it('throws when distributing a non-zero total across zero shares', () => {
    expect(() => distributeByWeight(100, [])).toThrow();
  });

  it('distributes zero across zero shares without error', () => {
    expect(distributeByWeight(0, [])).toEqual({});
  });

  it('property: shares always sum back to the total, for randomised totals and participant counts', () => {
    const rng = mulberry32(42);
    for (let trial = 0; trial < 500; trial++) {
      const total = randomInt(rng, 0, 100_000);
      const participantCount = randomInt(rng, 1, 12);
      const ids = Array.from({ length: participantCount }, (_, i) => `p${i}`);
      const shares = ids.map((id) => ({ id, weight: { num: randomInt(rng, 1, 20), den: 1 } }));

      const result = distributeByWeight(total, shares);
      const sum = Object.values(result).reduce((a, b) => a + b, 0);
      expect(sum).toBe(total);
    }
  });

  it('property: the result does not depend on the order shares are passed in', () => {
    const rng = mulberry32(7);
    for (let trial = 0; trial < 200; trial++) {
      const total = randomInt(rng, 0, 100_000);
      const participantCount = randomInt(rng, 2, 10);
      const shares = Array.from({ length: participantCount }, (_, i) => ({
        id: `p${i}`,
        weight: { num: randomInt(rng, 1, 20), den: 1 },
      }));

      const forward = distributeByWeight(total, shares);
      const shuffled = [...shares].reverse();
      const backward = distributeByWeight(total, shuffled);

      expect(backward).toEqual(forward);
    }
  });

  it('property: is deterministic — the same input always produces the same output', () => {
    const rng = mulberry32(99);
    for (let trial = 0; trial < 100; trial++) {
      const total = randomInt(rng, 0, 100_000);
      const shares = Array.from({ length: randomInt(rng, 1, 8) }, (_, i) => ({
        id: `p${i}`,
        weight: { num: randomInt(rng, 1, 20), den: 1 },
      }));

      expect(distributeByWeight(total, shares)).toEqual(distributeByWeight(total, shares));
    }
  });
});
