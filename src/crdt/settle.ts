// Records a settle-up payment (docs/plan/EXECUTE.md §5.2/§5.4, ADR-006). Shared by the chat
// thread (spans every group the pair shares) and the group screen (scoped to one group):
// both allocate oldest-outstanding-first and append the settlement to whichever group holds
// the oldest allocation, since a settlement event lives in one Y.Doc but its allocations may
// reference splits in any group the pair shares.

import { allocateSettlement } from '../core/balance';
import { newId } from '../core/id';
import { getOutstandingSplits } from '../db/queries/settle';
import { SqliteExecutor } from '../db/migrations/runner';
import { appendSettlement } from './write';
import { writeToGroup } from './store';

export async function recordSettlement(
  db: SqliteExecutor,
  selfDeviceId: string,
  fromUserId: string,
  toUserId: string,
  amountMinorUnits: number,
  currency: string,
  groupId?: string
): Promise<void> {
  const outstanding = await getOutstandingSplits(db, fromUserId, toUserId, currency, groupId);
  if (outstanding.length === 0) {
    throw new Error('Nothing outstanding to settle');
  }

  const allocations = allocateSettlement(
    amountMinorUnits,
    outstanding.map((o) => ({ scopeKey: o.scopeKey, outstandingAmountMinorUnits: o.outstandingAmountMinorUnits }))
  );

  const now = new Date().toISOString();
  await writeToGroup(db, outstanding[0].crdtDocId, selfDeviceId, (doc) => {
    appendSettlement(doc, {
      settlementId: newId('stl'),
      fromUserId,
      toUserId,
      amount: amountMinorUnits,
      currency,
      settledAt: now,
      method: null,
      note: null,
      allocations: allocations.map((a) => ({ scopeKey: a.scopeKey, amount: a.amountMinorUnits, currency })),
      createdByDeviceId: selfDeviceId,
      createdAt: now,
    });
  });
}
