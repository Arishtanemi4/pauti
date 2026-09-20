import { describe, expect, it, beforeEach } from 'vitest';
import { SqliteExecutor, runMigrations } from '../migrations/runner';
import { migrations } from '../migrations';
import { createNodeSqliteExecutor } from '../testing/nodeSqliteExecutor';
import { seedFixtures, FIXTURE_IDS } from '../testing/fixtures';
import { netBalances } from '../../core/balance';
import { getBalanceTiles } from './home';

let db: SqliteExecutor;

beforeEach(async () => {
  db = createNodeSqliteExecutor();
  await runMigrations(db, migrations);
  await seedFixtures(db);
});

describe('getBalanceTiles', () => {
  it('matches src/core/balance netted from the same raw outstanding splits, for every user and currency', async () => {
    const outstanding = await db.getAllAsync<{
      creditor_id: string;
      debtor_id: string;
      currency: string;
      outstanding_amount: number;
    }>(`SELECT creditor_id, debtor_id, currency, outstanding_amount FROM v_split_outstanding`);

    const byCurrency = new Map<string, { from: string; to: string; amountMinorUnits: number }[]>();
    for (const row of outstanding) {
      const list = byCurrency.get(row.currency) ?? [];
      list.push({ from: row.debtor_id, to: row.creditor_id, amountMinorUnits: row.outstanding_amount });
      byCurrency.set(row.currency, list);
    }

    for (const [currency, debts] of byCurrency) {
      const expectedNet = netBalances(debts);

      for (const userId of Object.values(FIXTURE_IDS.users)) {
        const tiles = await getBalanceTiles(db, userId);
        const tile = tiles.find((t) => t.currency === currency);
        const actualNet = tile?.netMinorUnits ?? 0;
        expect(actualNet).toBe(expectedNet[userId] ?? 0);
      }
    }
  });

  it('INR: Alice net matches the hand-computed fixture balance (-2350)', async () => {
    const tiles = await getBalanceTiles(db, FIXTURE_IDS.users.alice);
    const inr = tiles.find((t) => t.currency === 'INR');
    expect(inr?.netMinorUnits).toBe(-2350);
  });

  it('the settlement across two groups fully clears the Alice→Carol INR debt', async () => {
    const tiles = await getBalanceTiles(db, FIXTURE_IDS.users.alice);
    const inr = tiles.find((t) => t.currency === 'INR');
    // Alice still owes Bob (T1) and is owed by Bob (T2); Carol is settled to zero.
    expect(inr).toBeDefined();

    const carolTiles = await getBalanceTiles(db, FIXTURE_IDS.users.carol);
    const carolInr = carolTiles.find((t) => t.currency === 'INR');
    // Carol is still owed by Bob (T3); Alice's share of T3+T4b is fully settled.
    expect(carolInr?.owedToMeMinorUnits).toBe(1000);
  });
});
