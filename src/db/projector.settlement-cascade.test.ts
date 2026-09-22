import { describe, expect, it, beforeEach } from 'vitest';
import { SqliteExecutor, runMigrations } from './migrations/runner';
import { migrations } from './migrations';
import { createNodeSqliteExecutor } from './testing/nodeSqliteExecutor';
import { seedFixtures, FIXTURE_IDS } from './fixtures';
import { writeToGroup } from '../crdt/store';
import { createTransaction, setLine, setSplitSet } from '../crdt/write';
import { recordSettlement } from '../crdt/settle';
import { newId } from '../core/id';

const DEVICE_ID = 'dev_fixture';

let db: SqliteExecutor;

beforeEach(async () => {
  db = createNodeSqliteExecutor();
  await runMigrations(db, migrations);
  await seedFixtures(db);
});

describe('projectGroupDoc: replaying a group with settled splits', () => {
  it('creates a later HEADER_ONLY transaction without an FK error, and keeps settlement_allocations intact', async () => {
    const crdtDocId = `crdt_${FIXTURE_IDS.groups.trio}`;
    const { alice, bob, carol } = FIXTURE_IDS.users;

    // 1. Pizza: one line, ITEMIZED, 600.00 total.
    const pizzaTrxnId = newId('trx');
    const lineId = newId('lin');
    const now = new Date().toISOString();
    await writeToGroup(db, crdtDocId, DEVICE_ID, (doc) => {
      createTransaction(doc, DEVICE_ID, {
        trxnId: pizzaTrxnId,
        groupId: FIXTURE_IDS.groups.trio,
        payerUserId: alice,
        ownerDeviceId: DEVICE_ID,
        storeId: null,
        paymentModeId: null,
        trxnDate: '2026-09-22',
        description: null,
        totalAmount: 60000,
        currency: 'INR',
        detailLevel: 'ITEMIZED',
        sourceType: 'MANUAL',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
      setLine(doc, DEVICE_ID, {
        lineId,
        trxnId: pizzaTrxnId,
        lineNo: 1,
        productName: 'Pizza',
        quantityNum: 1,
        quantityDen: 1,
        unitPrice: null,
        lineAmount: 60000,
        deletedAt: null,
      });
    });

    // 2. Split the pizza line 3 ways, unequal EXACT: alice 10000, bob 20000, carol 30000.
    await writeToGroup(db, crdtDocId, DEVICE_ID, (doc) => {
      setSplitSet(doc, DEVICE_ID, {
        scopeKey: lineId,
        trxnId: pizzaTrxnId,
        lineId,
        shares: [
          { debtorId: alice, owedAmount: 10000, currency: 'INR', splitMode: 'EXACT', weightNum: 1, weightDen: 1 },
          { debtorId: bob, owedAmount: 20000, currency: 'INR', splitMode: 'EXACT', weightNum: 1, weightDen: 1 },
          { debtorId: carol, owedAmount: 30000, currency: 'INR', splitMode: 'EXACT', weightNum: 1, weightDen: 1 },
        ],
        updatedAt: now,
        updatedByDeviceId: DEVICE_ID,
      });
    });

    // 3. Settle from chat: unscoped bob -> alice, whatever's outstanding.
    const outstandingRows = await db.getAllAsync<{ outstanding_amount: number }>(
      `SELECT outstanding_amount FROM v_split_outstanding WHERE debtor_id = ? AND creditor_id = ? AND currency = 'INR'`,
      [bob, alice]
    );
    const netOwed = outstandingRows.reduce((a, r) => a + r.outstanding_amount, 0);
    await recordSettlement(db, DEVICE_ID, bob, alice, netOwed, 'INR');

    // 4. Now create a second, HEADER_ONLY (lineless) transaction in the same group.
    const headerOnlyTrxnId = newId('trx');
    await writeToGroup(db, crdtDocId, DEVICE_ID, (doc) => {
      createTransaction(doc, DEVICE_ID, {
        trxnId: headerOnlyTrxnId,
        groupId: FIXTURE_IDS.groups.trio,
        payerUserId: alice,
        ownerDeviceId: DEVICE_ID,
        storeId: null,
        paymentModeId: null,
        trxnDate: '2026-09-22',
        description: null,
        totalAmount: 20000,
        currency: 'INR',
        detailLevel: 'HEADER_ONLY',
        sourceType: 'MANUAL',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    });

    const rows = await db.getAllAsync<{ detail_level: string }>(
      `SELECT detail_level FROM transaction_header WHERE trxn_id = ?`,
      [headerOnlyTrxnId]
    );
    expect(rows).toEqual([{ detail_level: 'HEADER_ONLY' }]);

    // The settlement's allocations must survive the cascade + re-projection intact.
    const [settlement] = await db.getAllAsync<{ settlement_id: string }>(
      `SELECT settlement_id FROM settlements WHERE from_user_id = ? AND to_user_id = ? ORDER BY created_at DESC LIMIT 1`,
      [bob, alice]
    );
    const allocRows = await db.getAllAsync<{ total: number }>(
      `SELECT SUM(amount) AS total FROM settlement_allocations WHERE settlement_id = ?`,
      [settlement.settlement_id]
    );
    expect(allocRows[0].total).toBe(netOwed);

    const stillOutstanding = await db.getAllAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM v_split_outstanding WHERE debtor_id = ? AND creditor_id = ? AND currency = 'INR' AND outstanding_amount > 0`,
      [bob, alice]
    );
    expect(stillOutstanding[0].n).toBe(0);
  });
});
