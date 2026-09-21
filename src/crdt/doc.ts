// The CRDT document schema (docs/architecture.md ADR-004). One Y.Doc per group — a 1:1
// relationship is just a group with two members and isPair = true. This file is the passive
// shape of that document: typed records and thin accessors. Mutating it with the ownership
// rules from ADR-005 enforced is write.ts's job, not this file's.

import * as Y from 'yjs';

export interface GroupMeta {
  groupName: string;
  defaultCurrency: string;
  isPair: boolean;
}

export interface GroupMember {
  userId: string;
  role: 'owner' | 'member';
  joinedAt: string;
  deletedAt: string | null;
}

export interface TransactionHeader {
  trxnId: string;
  groupId: string;
  payerUserId: string;
  /** The device that created this transaction — per ADR-005, the only device allowed to write it. */
  ownerDeviceId: string;
  storeId: string | null;
  paymentModeId: string | null;
  trxnDate: string;
  description: string | null;
  totalAmount: number; // minor units
  currency: string;
  detailLevel: 'HEADER_ONLY' | 'PARTIAL' | 'ITEMIZED';
  sourceType: 'MANUAL' | 'RECEIPT_OCR' | 'STATEMENT_IMPORT';
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TransactionLine {
  lineId: string;
  trxnId: string;
  lineNo: number;
  productName: string;
  quantityNum: number;
  quantityDen: number;
  unitPrice: number | null; // minor units
  lineAmount: number; // minor units
  deletedAt: string | null;
}

export interface SplitShare {
  debtorId: string;
  owedAmount: number; // minor units
  currency: string;
  splitMode: 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES';
  weightNum: number;
  weightDen: number;
}

/**
 * One scope's split, replaced wholesale (docs/architecture.md ADR-004: "an atomic
 * last-write-wins register per scope"). A re-split never merges old shares with new ones
 * field by field — it's the old SplitSet or the new one, never a blend.
 */
export interface SplitSet {
  scopeKey: string; // COALESCE(lineId, trxnId) — matches schema.sql's expense_splits.scope_key
  trxnId: string;
  lineId: string | null;
  shares: SplitShare[];
  updatedAt: string;
  updatedByDeviceId: string;
}

export interface SettlementAllocation {
  scopeKey: string;
  amount: number; // minor units
  currency: string;
}

/** Append-only (ADR-004): settlement status is derived from these events, never a stored boolean. */
export interface SettlementEvent {
  settlementId: string;
  fromUserId: string;
  toUserId: string;
  amount: number; // minor units
  currency: string;
  settledAt: string;
  method: string | null;
  note: string | null;
  allocations: SettlementAllocation[];
  createdByDeviceId: string;
  createdAt: string;
}

export function createGroupDoc(): Y.Doc {
  return new Y.Doc();
}

export function getMeta(doc: Y.Doc): Y.Map<GroupMeta[keyof GroupMeta]> {
  return doc.getMap('meta');
}

/** Keyed by userId. */
export function getMembers(doc: Y.Doc): Y.Map<GroupMember> {
  return doc.getMap('members');
}

/** Keyed by trxnId. */
export function getTransactions(doc: Y.Doc): Y.Map<TransactionHeader> {
  return doc.getMap('transactions');
}

/** Keyed by lineId. */
export function getLines(doc: Y.Doc): Y.Map<TransactionLine> {
  return doc.getMap('lines');
}

/** Keyed by scopeKey. */
export function getSplitSets(doc: Y.Doc): Y.Map<SplitSet> {
  return doc.getMap('splitSets');
}

export function getSettlements(doc: Y.Doc): Y.Array<SettlementEvent> {
  return doc.getArray('settlements');
}
