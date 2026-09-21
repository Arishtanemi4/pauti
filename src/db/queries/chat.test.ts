import { describe, expect, it, beforeEach } from 'vitest';
import { SqliteExecutor, runMigrations } from '../migrations/runner';
import { migrations } from '../migrations';
import { createNodeSqliteExecutor } from '../testing/nodeSqliteExecutor';
import { seedFixtures, FIXTURE_IDS } from '../fixtures';
import { netBalances } from '../../core/balance';
import { getContactBalances } from './chat';

let db: SqliteExecutor;

beforeEach(async () => {
  db = createNodeSqliteExecutor();
  await runMigrations(db, migrations);
  await seedFixtures(db);
});

describe('getContactBalances', () => {
  it('matches src/core/balance netted from the same pair-only outstanding splits, for every pair and currency', async () => {
    const outstanding = await db.getAllAsync<{
      creditor_id: string;
      debtor_id: string;
      currency: string;
      outstanding_amount: number;
    }>(`SELECT creditor_id, debtor_id, currency, outstanding_amount FROM v_split_outstanding`);

    const { alice, bob, carol } = FIXTURE_IDS.users;
    for (const [self, other] of [
      [alice, bob],
      [alice, carol],
      [bob, carol],
    ]) {
      const pairDebts = new Map<string, { from: string; to: string; amountMinorUnits: number }[]>();
      for (const row of outstanding) {
        const parties = [row.creditor_id, row.debtor_id];
        if (!parties.includes(self) || !parties.includes(other)) continue;
        const list = pairDebts.get(row.currency) ?? [];
        list.push({ from: row.debtor_id, to: row.creditor_id, amountMinorUnits: row.outstanding_amount });
        pairDebts.set(row.currency, list);
      }

      const contactBalances = await getContactBalances(db, self);
      const withOther = contactBalances.find((c) => c.userId === other);

      for (const [currency, debts] of pairDebts) {
        const expectedSelfNet = netBalances(debts)[self] ?? 0;
        const actual = withOther?.balances.find((b) => b.currency === currency)?.amountMinorUnits ?? 0;
        expect(actual).toBe(expectedSelfNet);
      }
    }
  });

  it("Bob's INR balance with Alice is +2350 (Alice owes Bob 3000 from T1, Bob owes Alice 650 from T2)", async () => {
    const balances = await getContactBalances(db, FIXTURE_IDS.users.bob);
    const withAlice = balances.find((b) => b.userId === FIXTURE_IDS.users.alice);
    expect(withAlice?.balances.find((b) => b.currency === 'INR')?.amountMinorUnits).toBe(2350);
  });
});
