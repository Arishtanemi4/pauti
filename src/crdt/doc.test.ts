import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  createGroupDoc,
  getLines,
  getMembers,
  getMeta,
  getSettlements,
  getSplitSets,
  getTransactions,
  SplitSet,
  TransactionHeader,
} from './doc';

describe('doc schema accessors', () => {
  it('meta, members, transactions and lines round-trip through a single doc', () => {
    const doc = createGroupDoc();

    getMeta(doc).set('groupName', 'Trio');
    getMeta(doc).set('defaultCurrency', 'INR');
    getMeta(doc).set('isPair', false);

    getMembers(doc).set('usr_alice', { userId: 'usr_alice', role: 'owner', joinedAt: '2026-01-01', deletedAt: null });

    const header: TransactionHeader = {
      trxnId: 'trx_1',
      groupId: 'grp_trio',
      payerUserId: 'usr_alice',
      ownerDeviceId: 'dev_alice',
      storeId: null,
      paymentModeId: null,
      trxnDate: '2026-01-05',
      description: null,
      totalAmount: 9000,
      currency: 'INR',
      detailLevel: 'HEADER_ONLY',
      sourceType: 'MANUAL',
      createdAt: '2026-01-05',
      updatedAt: '2026-01-05',
      deletedAt: null,
    };
    getTransactions(doc).set(header.trxnId, header);

    expect(getMeta(doc).get('groupName')).toBe('Trio');
    expect(getMembers(doc).get('usr_alice')?.role).toBe('owner');
    expect(getTransactions(doc).get('trx_1')).toEqual(header);
    expect(getLines(doc).size).toBe(0);
  });

  it('splitSets is a last-write-wins register: a re-split replaces the whole set, never merges field by field', () => {
    const docA = createGroupDoc();
    const initial = Y.encodeStateAsUpdate(docA);
    const docB = createGroupDoc();
    Y.applyUpdate(docB, initial);

    const splitA: SplitSet = {
      scopeKey: 'trx_1',
      trxnId: 'trx_1',
      lineId: null,
      shares: [
        { debtorId: 'usr_alice', owedAmount: 4500, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
        { debtorId: 'usr_bob', owedAmount: 4500, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
      ],
      updatedAt: '2026-01-05T10:00:00Z',
      updatedByDeviceId: 'dev_alice',
    };
    const splitB: SplitSet = {
      scopeKey: 'trx_1',
      trxnId: 'trx_1',
      lineId: null,
      shares: [
        { debtorId: 'usr_alice', owedAmount: 3000, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
        { debtorId: 'usr_bob', owedAmount: 3000, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
        { debtorId: 'usr_carol', owedAmount: 3000, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 },
      ],
      updatedAt: '2026-01-05T10:00:01Z',
      updatedByDeviceId: 'dev_alice',
    };

    getSplitSets(docA).set('trx_1', splitA);
    getSplitSets(docB).set('trx_1', splitB);

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    const resolvedA = getSplitSets(docA).get('trx_1');
    const resolvedB = getSplitSets(docB).get('trx_1');
    expect(resolvedA).toEqual(resolvedB);

    // Whichever side won, it's one whole SplitSet — never e.g. splitA's shares with splitB's
    // updatedAt, which could disagree about how many people owe money on this bill.
    const isWholeA = resolvedA?.updatedAt === splitA.updatedAt && resolvedA.shares.length === splitA.shares.length;
    const isWholeB = resolvedA?.updatedAt === splitB.updatedAt && resolvedA.shares.length === splitB.shares.length;
    expect(isWholeA || isWholeB).toBe(true);
  });

  it('settlements is append-only: concurrent settlements from two devices are both retained', () => {
    const docA = createGroupDoc();
    const initial = Y.encodeStateAsUpdate(docA);
    const docB = createGroupDoc();
    Y.applyUpdate(docB, initial);

    getSettlements(docA).push([
      {
        settlementId: 'stl_1',
        fromUserId: 'usr_bob',
        toUserId: 'usr_alice',
        amount: 500,
        currency: 'INR',
        settledAt: '2026-01-10',
        method: 'cash',
        note: null,
        allocations: [],
        createdByDeviceId: 'dev_bob',
        createdAt: '2026-01-10',
      },
    ]);
    getSettlements(docB).push([
      {
        settlementId: 'stl_2',
        fromUserId: 'usr_carol',
        toUserId: 'usr_alice',
        amount: 300,
        currency: 'INR',
        settledAt: '2026-01-11',
        method: 'upi',
        note: null,
        allocations: [],
        createdByDeviceId: 'dev_carol',
        createdAt: '2026-01-11',
      },
    ]);

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    expect(getSettlements(docA).toArray()).toHaveLength(2);
    expect(getSettlements(docA).toArray().map((s) => s.settlementId).sort()).toEqual(['stl_1', 'stl_2']);
  });
});
