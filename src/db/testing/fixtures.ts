// Fixture dataset for Phase 2 (docs/plan/EXECUTE.md task 2.4), covering:
//   - a HEADER_ONLY statement expense           (T1, grp_trio)
//   - an ITEMIZED receipt with a partial item split (T2, grp_pair, 1/3 + 2/3 on the wine)
//   - a three-person group                      (grp_trio)
//   - a pair                                    (grp_pair, is_pair = 1)
//   - a settlement spanning two groups           (stl_1, allocated against T3 + T4b)
//   - a multi-currency expense                   (T5, USD against an otherwise-INR ledger)
//
// All amounts are integer minor units (paise). Dates are fixed, not wall-clock, so tests
// are reproducible.

import { SqliteExecutor } from '../migrations/runner';

export const FIXTURE_IDS = {
  users: { alice: 'usr_alice', bob: 'usr_bob', carol: 'usr_carol' },
  groups: { trio: 'grp_trio', pairAB: 'grp_pair_ab', pairAC: 'grp_pair_ac' },
  trxns: { t1: 'trx_t1', t2: 'trx_t2', t3: 'trx_t3', t4b: 'trx_t4b', t5: 'trx_t5' },
} as const;

export async function seedFixtures(db: SqliteExecutor): Promise<void> {
  const exec = (sql: string, params: readonly unknown[] = []) => db.runAsync(sql, params);
  const device = 'dev_fixture';

  await exec(
    `INSERT INTO devices (device_id, device_name, public_key, is_self) VALUES (?, ?, ?, 1)`,
    [device, 'Fixture device', Buffer.from('fixture')]
  );

  for (const [key, id] of Object.entries(FIXTURE_IDS.users)) {
    await exec(
      `INSERT INTO users (user_id, username, default_currency, is_self, created_by_device_id)
       VALUES (?, ?, 'INR', ?, ?)`,
      [id, key, key === 'alice' ? 1 : 0, device]
    );
  }

  const crdtDocFor = async (groupId: string) => {
    const crdtDocId = `crdt_${groupId}`;
    await exec(`INSERT INTO crdt_docs (crdt_doc_id, scope) VALUES (?, 'GROUP')`, [crdtDocId]);
    return crdtDocId;
  };

  const { trio, pairAB, pairAC } = FIXTURE_IDS.groups;
  await exec(
    `INSERT INTO groups (group_id, group_name, is_pair, default_currency, crdt_doc_id, created_by_device_id)
     VALUES (?, 'Trio', 0, 'INR', ?, ?)`,
    [trio, await crdtDocFor(trio), device]
  );
  await exec(
    `INSERT INTO groups (group_id, group_name, is_pair, default_currency, crdt_doc_id, created_by_device_id)
     VALUES (?, 'Alice & Bob', 1, 'INR', ?, ?)`,
    [pairAB, await crdtDocFor(pairAB), device]
  );
  await exec(
    `INSERT INTO groups (group_id, group_name, is_pair, default_currency, crdt_doc_id, created_by_device_id)
     VALUES (?, 'Alice & Carol', 1, 'INR', ?, ?)`,
    [pairAC, await crdtDocFor(pairAC), device]
  );

  const { alice, bob, carol } = FIXTURE_IDS.users;
  const addMember = (groupId: string, userId: string) =>
    exec(`INSERT INTO group_members (group_id, user_id, created_by_device_id) VALUES (?, ?, ?)`, [
      groupId,
      userId,
      device,
    ]);
  await addMember(trio, alice);
  await addMember(trio, bob);
  await addMember(trio, carol);
  await addMember(pairAB, alice);
  await addMember(pairAB, bob);
  await addMember(pairAC, alice);
  await addMember(pairAC, carol);

  const store = 'str_shop1';
  await exec(`INSERT INTO stores (store_id, store_name, created_by_device_id) VALUES (?, 'Corner Shop', ?)`, [
    store,
    device,
  ]);

  const insertHeader = (params: {
    trxnId: string;
    groupId: string;
    payerUserId: string;
    totalAmount: number;
    currency: string;
    detailLevel: 'HEADER_ONLY' | 'ITEMIZED';
    sourceType: 'MANUAL' | 'RECEIPT_OCR' | 'STATEMENT_IMPORT';
    storeId?: string;
    trxnDate: string;
  }) =>
    exec(
      `INSERT INTO transaction_header
         (trxn_id, group_id, payer_user_id, store_id, trxn_date, total_amount, currency,
          detail_level, source_type, created_by_device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.trxnId,
        params.groupId,
        params.payerUserId,
        params.storeId ?? null,
        params.trxnDate,
        params.totalAmount,
        params.currency,
        params.detailLevel,
        params.sourceType,
        device,
      ]
    );

  const insertSplit = (params: {
    splitId: string;
    trxnId: string;
    lineId: string | null;
    debtorId: string;
    owedAmount: number;
    currency: string;
    splitMode: 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES';
    weightNum?: number;
    weightDen?: number;
  }) =>
    exec(
      `INSERT INTO expense_splits
         (split_id, trxn_id, line_id, scope_key, debtor_id, owed_amount, currency, split_mode,
          weight_num, weight_den, created_by_device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        params.splitId,
        params.trxnId,
        params.lineId,
        params.lineId ?? params.trxnId,
        params.debtorId,
        params.owedAmount,
        params.currency,
        params.splitMode,
        params.weightNum ?? 1,
        params.weightDen ?? 1,
        device,
      ]
    );

  // T1 — HEADER_ONLY statement expense, three-person group, EQUAL split (9000 / 3 = 3000 exactly).
  const { t1, t2, t3, t4b, t5 } = FIXTURE_IDS.trxns;
  await insertHeader({
    trxnId: t1,
    groupId: trio,
    payerUserId: bob,
    totalAmount: 9000,
    currency: 'INR',
    detailLevel: 'HEADER_ONLY',
    sourceType: 'STATEMENT_IMPORT',
    trxnDate: '2026-01-05',
  });
  for (const debtor of [alice, bob, carol]) {
    await insertSplit({
      splitId: `splt_${t1}_${debtor}`,
      trxnId: t1,
      lineId: null,
      debtorId: debtor,
      owedAmount: 3000,
      currency: 'INR',
      splitMode: 'EQUAL',
    });
  }

  // T2 — ITEMIZED receipt, pair group. One line (Wine, 900), split 1/3 Alice : 2/3 Bob.
  // Header-scope remainder (1000 - 900 = 100) split EQUAL.
  await insertHeader({
    trxnId: t2,
    groupId: pairAB,
    payerUserId: alice,
    storeId: store,
    totalAmount: 1000,
    currency: 'INR',
    detailLevel: 'ITEMIZED',
    sourceType: 'RECEIPT_OCR',
    trxnDate: '2026-01-10',
  });
  const wineLine = 'lin_wine';
  await exec(
    `INSERT INTO transaction_lines
       (line_id, trxn_id, line_no, product_name, line_amount, created_by_device_id)
     VALUES (?, ?, 1, 'Wine', 900, ?)`,
    [wineLine, t2, device]
  );
  await insertSplit({
    splitId: `splt_${wineLine}_${alice}`,
    trxnId: t2,
    lineId: wineLine,
    debtorId: alice,
    owedAmount: 300,
    currency: 'INR',
    splitMode: 'SHARES',
    weightNum: 1,
    weightDen: 3,
  });
  await insertSplit({
    splitId: `splt_${wineLine}_${bob}`,
    trxnId: t2,
    lineId: wineLine,
    debtorId: bob,
    owedAmount: 600,
    currency: 'INR',
    splitMode: 'SHARES',
    weightNum: 2,
    weightDen: 3,
  });
  for (const debtor of [alice, bob]) {
    await insertSplit({
      splitId: `splt_${t2}_${debtor}`,
      trxnId: t2,
      lineId: null,
      debtorId: debtor,
      owedAmount: 50,
      currency: 'INR',
      splitMode: 'EQUAL',
    });
  }

  // T3 + T4b — two expenses, in two different groups, both owed by Alice to Carol. A single
  // settlement below allocates against both, spanning both groups.
  await insertHeader({
    trxnId: t3,
    groupId: trio,
    payerUserId: carol,
    totalAmount: 3000,
    currency: 'INR',
    detailLevel: 'HEADER_ONLY',
    sourceType: 'MANUAL',
    trxnDate: '2026-01-12',
  });
  for (const debtor of [alice, bob, carol]) {
    await insertSplit({
      splitId: `splt_${t3}_${debtor}`,
      trxnId: t3,
      lineId: null,
      debtorId: debtor,
      owedAmount: 1000,
      currency: 'INR',
      splitMode: 'EQUAL',
    });
  }

  await insertHeader({
    trxnId: t4b,
    groupId: pairAC,
    payerUserId: carol,
    totalAmount: 2000,
    currency: 'INR',
    detailLevel: 'HEADER_ONLY',
    sourceType: 'MANUAL',
    trxnDate: '2026-01-14',
  });
  for (const debtor of [alice, carol]) {
    await insertSplit({
      splitId: `splt_${t4b}_${debtor}`,
      trxnId: t4b,
      lineId: null,
      debtorId: debtor,
      owedAmount: 1000,
      currency: 'INR',
      splitMode: 'EQUAL',
    });
  }

  await exec(
    `INSERT INTO settlements (settlement_id, from_user_id, to_user_id, amount, currency, settled_at, created_by_device_id)
     VALUES ('stl_1', ?, ?, 2000, 'INR', '2026-01-20', ?)`,
    [alice, carol, device]
  );
  await exec(
    `INSERT INTO settlement_allocations (allocation_id, settlement_id, split_id, amount, currency, created_by_device_id)
     VALUES ('alc_1', 'stl_1', ?, 1000, 'INR', ?)`,
    [`splt_${t3}_${alice}`, device]
  );
  await exec(
    `INSERT INTO settlement_allocations (allocation_id, settlement_id, split_id, amount, currency, created_by_device_id)
     VALUES ('alc_2', 'stl_1', ?, 1000, 'INR', ?)`,
    [`splt_${t4b}_${alice}`, device]
  );

  // T5 — multi-currency expense (USD, everything else above is INR).
  await insertHeader({
    trxnId: t5,
    groupId: pairAC,
    payerUserId: alice,
    totalAmount: 5000,
    currency: 'USD',
    detailLevel: 'HEADER_ONLY',
    sourceType: 'MANUAL',
    trxnDate: '2026-01-18',
  });
  for (const debtor of [alice, carol]) {
    await insertSplit({
      splitId: `splt_${t5}_${debtor}`,
      trxnId: t5,
      lineId: null,
      debtorId: debtor,
      owedAmount: 2500,
      currency: 'USD',
      splitMode: 'EQUAL',
    });
  }
}
