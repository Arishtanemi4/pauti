import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrations } from './migrations';

describe('schema.sql', () => {
  it('matches migrations/*.ts applied in order, exactly — the two must never drift apart', () => {
    const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));
    const schemaSql = readFileSync(schemaPath, 'utf8');
    expect(migrations.map((m) => m.sql).join('')).toBe(schemaSql);
  });
});
