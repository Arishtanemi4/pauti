import { describe, expect, it } from 'vitest';
import { fnv1a } from './hash';

describe('fnv1a', () => {
  it('is deterministic', () => {
    expect(fnv1a('2026-01-05|Coffee Shop|-350|9650')).toBe(fnv1a('2026-01-05|Coffee Shop|-350|9650'));
  });

  it('differs for different input', () => {
    expect(fnv1a('a')).not.toBe(fnv1a('b'));
  });
});
