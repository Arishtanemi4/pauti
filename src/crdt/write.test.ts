import { describe, expect, it } from 'vitest';
import { createGroupDoc, getSplitSets, getTransactions, TransactionHeader } from './doc';
import { appendSettlement, createTransaction, OwnershipError, setLine, setSplitSet, updateTransaction, upsertMeta } from './write';

function makeHeader(overrides: Partial<TransactionHeader> = {}): TransactionHeader {
  return {
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
    ...overrides,
  };
}

describe('createTransaction', () => {
  it('succeeds when the creating device matches ownerDeviceId', () => {
    const doc = createGroupDoc();
    createTransaction(doc, 'dev_alice', makeHeader());
    expect(getTransactions(doc).get('trx_1')?.ownerDeviceId).toBe('dev_alice');
  });

  it('rejects a device creating a transaction it does not own', () => {
    const doc = createGroupDoc();
    expect(() => createTransaction(doc, 'dev_bob', makeHeader({ ownerDeviceId: 'dev_alice' }))).toThrow(
      OwnershipError
    );
  });

  it('rejects creating a transaction that already exists', () => {
    const doc = createGroupDoc();
    createTransaction(doc, 'dev_alice', makeHeader());
    expect(() => createTransaction(doc, 'dev_alice', makeHeader())).toThrow(OwnershipError);
  });
});

describe('updateTransaction', () => {
  it('the owning device can update its own transaction', () => {
    const doc = createGroupDoc();
    createTransaction(doc, 'dev_alice', makeHeader());
    updateTransaction(doc, 'dev_alice', makeHeader({ description: 'Groceries' }));
    expect(getTransactions(doc).get('trx_1')?.description).toBe('Groceries');
  });

  it('a non-owning device is rejected, never silently merged', () => {
    const doc = createGroupDoc();
    createTransaction(doc, 'dev_alice', makeHeader());
    expect(() => updateTransaction(doc, 'dev_bob', makeHeader({ description: 'Hijacked' }))).toThrow(OwnershipError);
    // The rejected write must not have taken effect.
    expect(getTransactions(doc).get('trx_1')?.description).toBeNull();
  });
});

describe('setLine and setSplitSet', () => {
  it('the owning device can write a line and a split', () => {
    const doc = createGroupDoc();
    createTransaction(doc, 'dev_alice', makeHeader());
    setLine(doc, 'dev_alice', {
      lineId: 'lin_1',
      trxnId: 'trx_1',
      lineNo: 1,
      productName: 'Wine',
      quantityNum: 1,
      quantityDen: 1,
      unitPrice: null,
      lineAmount: 900,
      deletedAt: null,
    });
    setSplitSet(doc, 'dev_alice', {
      scopeKey: 'trx_1',
      trxnId: 'trx_1',
      lineId: null,
      shares: [{ debtorId: 'usr_alice', owedAmount: 9000, currency: 'INR', splitMode: 'EQUAL', weightNum: 1, weightDen: 1 }],
      updatedAt: '2026-01-05',
      updatedByDeviceId: 'dev_alice',
    });
    expect(getSplitSets(doc).get('trx_1')?.shares).toHaveLength(1);
  });

  it('a non-owning device is rejected on both lines and splits', () => {
    const doc = createGroupDoc();
    createTransaction(doc, 'dev_alice', makeHeader());

    expect(() =>
      setLine(doc, 'dev_bob', {
        lineId: 'lin_1',
        trxnId: 'trx_1',
        lineNo: 1,
        productName: 'Hijacked',
        quantityNum: 1,
        quantityDen: 1,
        unitPrice: null,
        lineAmount: 100,
        deletedAt: null,
      })
    ).toThrow(OwnershipError);

    expect(() =>
      setSplitSet(doc, 'dev_bob', {
        scopeKey: 'trx_1',
        trxnId: 'trx_1',
        lineId: null,
        shares: [],
        updatedAt: '2026-01-05',
        updatedByDeviceId: 'dev_bob',
      })
    ).toThrow(OwnershipError);
  });

  it('rejects writing a line for a transaction that does not exist', () => {
    const doc = createGroupDoc();
    expect(() =>
      setLine(doc, 'dev_alice', {
        lineId: 'lin_1',
        trxnId: 'trx_missing',
        lineNo: 1,
        productName: 'Ghost',
        quantityNum: 1,
        quantityDen: 1,
        unitPrice: null,
        lineAmount: 100,
        deletedAt: null,
      })
    ).toThrow(OwnershipError);
  });
});

describe('appendSettlement', () => {
  it('either party may append, with no ownership check', () => {
    const doc = createGroupDoc();
    appendSettlement(doc, {
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
    });
    expect(doc.getArray('settlements').length).toBe(1);
  });
});

describe('upsertMeta', () => {
  it('is shared — any device may write it', () => {
    const doc = createGroupDoc();
    upsertMeta(doc, { groupName: 'Trio', defaultCurrency: 'INR' });
    expect(getMetaValue(doc, 'groupName')).toBe('Trio');
  });
});

function getMetaValue(doc: ReturnType<typeof createGroupDoc>, key: string) {
  return doc.getMap('meta').get(key);
}
