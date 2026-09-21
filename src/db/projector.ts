// CRDT update -> SQL rows (docs/plan/EXECUTE.md Phase 3.4). The ONLY code that may INSERT,
// UPDATE or DELETE derived tables (§0.1 rule 5) — everything else reads SQL and writes
// through src/crdt/write.ts instead.
//
// Every group is projected the same way regardless of why: a handful of new crdt_updates
// rows, or a full rebuild from an empty database (Phase 3.5). Both replay the full update
// history for the doc and overwrite that group's derived rows wholesale — there is no
// separate "incremental" code path to keep in sync with a "rebuild" one.

import * as Y from 'yjs';
import { SqliteExecutor } from './migrations/runner';
import { getLines, getMembers, getMeta, getSettlements, getSplitSets, getTransactions } from '../crdt/doc';

async function loadGroupDoc(db: SqliteExecutor, crdtDocId: string): Promise<Y.Doc> {
  const doc = new Y.Doc();
  const rows = await db.getAllAsync<{ payload: Uint8Array }>(
    `SELECT payload FROM crdt_updates WHERE crdt_doc_id = ? ORDER BY update_id`,
    [crdtDocId]
  );
  for (const row of rows) {
    Y.applyUpdate(doc, row.payload);
  }
  return doc;
}

/** Projects one group's fully-merged Y.Doc into its derived SQL rows. Idempotent. */
export async function projectGroupDoc(db: SqliteExecutor, groupId: string, doc: Y.Doc): Promise<void> {
  const meta = getMeta(doc);
  const groupName = meta.get('groupName');
  const defaultCurrency = meta.get('defaultCurrency');
  if (groupName !== undefined || defaultCurrency !== undefined) {
    await db.runAsync(
      `UPDATE groups SET
         group_name = COALESCE(?, group_name),
         default_currency = COALESCE(?, default_currency),
         updated_at = datetime('now')
       WHERE group_id = ?`,
      [groupName ?? null, defaultCurrency ?? null, groupId]
    );
  }

  // Members — projected wholesale from the shared members map (small, no incremental diff needed).
  for (const member of getMembers(doc).values()) {
    await db.runAsync(
      `INSERT INTO group_members (group_id, user_id, role, joined_at, deleted_at, created_by_device_id)
       VALUES (?, ?, ?, ?, ?, 'crdt-projected')
       ON CONFLICT(group_id, user_id) DO UPDATE SET role = excluded.role, deleted_at = excluded.deleted_at`,
      [groupId, member.userId, member.role, member.joinedAt, member.deletedAt]
    );
  }

  // Transactions.
  for (const header of getTransactions(doc).values()) {
    if (header.groupId !== groupId) continue;
    await db.runAsync(
      `INSERT INTO transaction_header
         (trxn_id, group_id, payer_user_id, store_id, payment_mode_id, trxn_date, description,
          total_amount, currency, detail_level, source_type, created_by_device_id, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
       ON CONFLICT(trxn_id) DO UPDATE SET
         payer_user_id = excluded.payer_user_id, store_id = excluded.store_id,
         payment_mode_id = excluded.payment_mode_id, trxn_date = excluded.trxn_date,
         description = excluded.description, total_amount = excluded.total_amount,
         currency = excluded.currency, detail_level = excluded.detail_level,
         source_type = excluded.source_type, updated_at = excluded.updated_at,
         deleted_at = excluded.deleted_at`,
      [
        header.trxnId,
        header.groupId,
        header.payerUserId,
        header.storeId,
        header.paymentModeId,
        header.trxnDate,
        header.description,
        header.totalAmount,
        header.currency,
        header.detailLevel,
        header.sourceType,
        header.ownerDeviceId,
        header.deletedAt,
      ]
    );
  }

  // Lines.
  for (const line of getLines(doc).values()) {
    const header = getTransactions(doc).get(line.trxnId);
    if (!header || header.groupId !== groupId) continue;
    await db.runAsync(
      `INSERT INTO transaction_lines
         (line_id, trxn_id, line_no, product_name, quantity_num, quantity_den, unit_price,
          line_amount, created_by_device_id, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
       ON CONFLICT(line_id) DO UPDATE SET
         line_no = excluded.line_no, product_name = excluded.product_name,
         quantity_num = excluded.quantity_num, quantity_den = excluded.quantity_den,
         unit_price = excluded.unit_price, line_amount = excluded.line_amount,
         updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`,
      [
        line.lineId,
        line.trxnId,
        line.lineNo,
        line.productName,
        line.quantityNum,
        line.quantityDen,
        line.unitPrice,
        line.lineAmount,
        header.ownerDeviceId,
        line.deletedAt,
      ]
    );
  }

  // splitSets — an atomic register per scope: replace that scope's rows wholesale, matching
  // ADR-004 exactly (never merge old and new shares).
  for (const splitSet of getSplitSets(doc).values()) {
    const header = getTransactions(doc).get(splitSet.trxnId);
    if (!header || header.groupId !== groupId) continue;

    await db.runAsync(`DELETE FROM expense_splits WHERE scope_key = ?`, [splitSet.scopeKey]);
    for (const share of splitSet.shares) {
      const splitId = `splt_${splitSet.scopeKey}_${share.debtorId}`;
      await db.runAsync(
        `INSERT INTO expense_splits
           (split_id, trxn_id, line_id, scope_key, debtor_id, owed_amount, currency, split_mode,
            weight_num, weight_den, created_by_device_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        [
          splitId,
          splitSet.trxnId,
          splitSet.lineId,
          splitSet.scopeKey,
          share.debtorId,
          share.owedAmount,
          share.currency,
          share.splitMode,
          share.weightNum,
          share.weightDen,
          splitSet.updatedByDeviceId,
        ]
      );
    }
  }

  // Settlements — append-only; each allocation targets the payer's (fromUserId's) split in
  // that scope, since a settlement is always between exactly two people (schema.sql CHECK
  // from_user_id <> to_user_id).
  for (const settlement of getSettlements(doc).toArray()) {
    await db.runAsync(
      `INSERT INTO settlements
         (settlement_id, from_user_id, to_user_id, amount, currency, settled_at, method, note, created_by_device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(settlement_id) DO UPDATE SET
         amount = excluded.amount, currency = excluded.currency, settled_at = excluded.settled_at,
         method = excluded.method, note = excluded.note, updated_at = datetime('now')`,
      [
        settlement.settlementId,
        settlement.fromUserId,
        settlement.toUserId,
        settlement.amount,
        settlement.currency,
        settlement.settledAt,
        settlement.method,
        settlement.note,
        settlement.createdByDeviceId,
      ]
    );

    for (const allocation of settlement.allocations) {
      const splitId = `splt_${allocation.scopeKey}_${settlement.fromUserId}`;
      const allocationId = `alc_${settlement.settlementId}_${allocation.scopeKey}`;
      await db.runAsync(
        `INSERT INTO settlement_allocations
           (allocation_id, settlement_id, split_id, amount, currency, created_by_device_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(allocation_id) DO UPDATE SET amount = excluded.amount, currency = excluded.currency`,
        [allocationId, settlement.settlementId, splitId, allocation.amount, allocation.currency, settlement.createdByDeviceId]
      );
    }
  }
}

/**
 * Projects every group with pending (unprojected) crdt_updates. Groups already registered
 * in the `groups` table (group_id <-> crdt_doc_id is app-level bootstrap data, not itself
 * derived from the op-log — see the module comment on why that linkage has to pre-exist).
 */
export async function runProjector(db: SqliteExecutor): Promise<void> {
  const pendingDocIds = await db.getAllAsync<{ crdt_doc_id: string }>(
    `SELECT DISTINCT crdt_doc_id FROM crdt_updates WHERE projected = 0`
  );

  for (const { crdt_doc_id: crdtDocId } of pendingDocIds) {
    const [group] = await db.getAllAsync<{ group_id: string }>(`SELECT group_id FROM groups WHERE crdt_doc_id = ?`, [
      crdtDocId,
    ]);
    if (!group) continue; // no SQL group registered for this doc yet — nothing to project into

    const doc = await loadGroupDoc(db, crdtDocId);
    await projectGroupDoc(db, group.group_id, doc);

    await db.runAsync(`UPDATE crdt_updates SET projected = 1 WHERE crdt_doc_id = ?`, [crdtDocId]);
    await db.runAsync(`UPDATE crdt_docs SET last_projected_at = datetime('now') WHERE crdt_doc_id = ?`, [crdtDocId]);
  }
}

/**
 * Full rebuild path (Phase 3.5): clears every derived row for groups the doc history covers,
 * then replays crdt_updates from scratch. A projector bug is fixed by rebuilding, not by
 * migrating (ADR-001).
 */
export async function rebuildFromLog(db: SqliteExecutor): Promise<void> {
  await db.execAsync(`
    DELETE FROM settlement_allocations;
    DELETE FROM settlements;
    DELETE FROM expense_splits;
    DELETE FROM transaction_lines;
    DELETE FROM transaction_header;
    DELETE FROM group_members;
  `);
  await db.runAsync(`UPDATE crdt_updates SET projected = 0`);
  await runProjector(db);
}
