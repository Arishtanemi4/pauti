import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migration0001Initial } from './migrations/0001_initial';

describe('schema.sql', () => {
  it('matches migrations/0001_initial.ts exactly — the two must never drift apart', () => {
    const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));
    const schemaSql = readFileSync(schemaPath, 'utf8');
    expect(migration0001Initial.sql).toBe(schemaSql);
  });
});
