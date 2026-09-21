// The ownership-checked write API (docs/architecture.md ADR-005). This is the ONLY place
// that may mutate a group Y.Doc — nothing else in the app writes to `doc.ts`'s maps/arrays
// directly. A write that violates ownership throws; it is never silently merged or dropped.

import {
  GroupMeta,
  GroupMember,
  SettlementEvent,
  SplitSet,
  TransactionHeader,
  TransactionLine,
  getLines,
  getMembers,
  getMeta,
  getSettlements,
  getSplitSets,
  getTransactions,
} from './doc';
import * as Y from 'yjs';

export class OwnershipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OwnershipError';
  }
}

function assertOwnsTransaction(doc: Y.Doc, trxnId: string, deviceId: string): TransactionHeader {
  const header = getTransactions(doc).get(trxnId);
  if (!header) {
    throw new OwnershipError(`Transaction ${trxnId} does not exist`);
  }
  if (header.ownerDeviceId !== deviceId) {
    throw new OwnershipError(
      `Device ${deviceId} does not own transaction ${trxnId} (owned by ${header.ownerDeviceId})`
    );
  }
  return header;
}

// --------------------------------------------------------------------------
// Group metadata and membership — shared, no single owner (ADR-005).
// --------------------------------------------------------------------------

export function upsertMeta(doc: Y.Doc, patch: Partial<GroupMeta>): void {
  const meta = getMeta(doc);
  for (const [key, value] of Object.entries(patch) as [keyof GroupMeta, GroupMeta[keyof GroupMeta]][]) {
    meta.set(key, value);
  }
}

export function upsertMember(doc: Y.Doc, member: GroupMember): void {
  getMembers(doc).set(member.userId, member);
}

// --------------------------------------------------------------------------
// Transactions, lines, splitSets — owned by the payer's device that created them.
// --------------------------------------------------------------------------

/** Creates a new transaction. `deviceId` becomes its owner. */
export function createTransaction(doc: Y.Doc, deviceId: string, header: TransactionHeader): void {
  if (getTransactions(doc).has(header.trxnId)) {
    throw new OwnershipError(`Transaction ${header.trxnId} already exists`);
  }
  if (header.ownerDeviceId !== deviceId) {
    throw new OwnershipError(`Device ${deviceId} cannot create a transaction owned by ${header.ownerDeviceId}`);
  }
  getTransactions(doc).set(header.trxnId, header);
}

/** Updates an existing transaction. Only the owning device may do this. */
export function updateTransaction(doc: Y.Doc, deviceId: string, header: TransactionHeader): void {
  assertOwnsTransaction(doc, header.trxnId, deviceId);
  if (header.ownerDeviceId !== deviceId) {
    throw new OwnershipError(`Device ${deviceId} cannot reassign ownership of transaction ${header.trxnId}`);
  }
  getTransactions(doc).set(header.trxnId, header);
}

/** Writes a line item. Only the device owning the line's parent transaction may do this. */
export function setLine(doc: Y.Doc, deviceId: string, line: TransactionLine): void {
  assertOwnsTransaction(doc, line.trxnId, deviceId);
  getLines(doc).set(line.lineId, line);
}

/**
 * Replaces a scope's split wholesale (ADR-004: atomic LWW register — never a field-by-field
 * merge). Only the device owning the scope's parent transaction may do this.
 */
export function setSplitSet(doc: Y.Doc, deviceId: string, splitSet: SplitSet): void {
  assertOwnsTransaction(doc, splitSet.trxnId, deviceId);
  getSplitSets(doc).set(splitSet.scopeKey, splitSet);
}

// --------------------------------------------------------------------------
// Settlements — append-only; either party may append (ADR-005).
// --------------------------------------------------------------------------

export function appendSettlement(doc: Y.Doc, settlement: SettlementEvent): void {
  getSettlements(doc).push([settlement]);
}
