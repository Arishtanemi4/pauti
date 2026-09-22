import { describe, expect, it } from 'vitest';
import { newId } from './id';

describe('newId', () => {
  it('prefixes the id', () => {
    expect(newId('trx')).toMatch(/^trx_[a-z0-9]+$/);
  });

  it('generates unique ids across many calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId('trx')));
    expect(ids.size).toBe(1000);
  });
});
