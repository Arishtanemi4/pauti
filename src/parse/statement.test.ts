import { describe, expect, it } from 'vitest';
import { parseStatementCsv, parseStatementText } from './statement';

// Synthetic HSBC-style text, structurally identical to the real fixtures validated in ml/
// (ml/README.md) but with invented dates, merchants and amounts — no real fixture content is
// ever copied into the committed test suite (docs/plan/EXECUTE.md rule 7).

describe('parseStatementText', () => {
  it('parses a single-line debit transaction', () => {
    const text = `
Account Summary
OpeningBalance £50.00
Date Payment type and details £Paid out £Paid in £Balance
12 Jan 26 BP SOME MERCHANT
London 10.00 40.00
21 Jan 26 BALANCECARRIEDFORWARD 40.00
`;
    const result = parseStatementText(text);
    expect(result.unresolvedCount).toBe(0);
    expect(result.entries).toEqual([
      { date: '2026-01-12', description: 'BP SOME MERCHANT London', amountMinorUnits: -1000, balanceAfterMinorUnits: 4000, signResolved: true },
    ]);
  });

  it('parses a multi-line transaction with several description-only lines', () => {
    const text = `
OpeningBalance £20.00
Date Payment type and details £Paid out £Paid in £Balance
20 Jan 26 SOME MERCHANT NAME
PART TWO OF NAME
CITY 10.41 9.59
21 Jan 26 BALANCECARRIEDFORWARD 9.59
`;
    const result = parseStatementText(text);
    expect(result.unresolvedCount).toBe(0);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].amountMinorUnits).toBe(-1041);
    expect(result.entries[0].balanceAfterMinorUnits).toBe(959);
  });

  it('resolves a same-day batch by matching total magnitude to the checkpoint delta', () => {
    // Same-date transactions are grouped; only the last one carries the running balance.
    const text = `
OpeningBalance £100.00
Date Payment type and details £Paid out £Paid in £Balance
05 Feb 26 SHOP A
CITY 5.00
SHOP B
CITY 3.00
SHOP C
CITY 2.00 90.00
06 Feb 26 BALANCECARRIEDFORWARD 90.00
`;
    const result = parseStatementText(text);
    expect(result.unresolvedCount).toBe(0);
    expect(result.entries.map((e) => e.amountMinorUnits)).toEqual([-500, -300, -200]);
    expect(result.entries[2].balanceAfterMinorUnits).toBe(9000);
  });

  it('resolves a mixed-sign same-day batch via subset-sum', () => {
    // opening 100.00; batch [+300.00, -100.00, -3.30, -0.99] => closing 295.71. Total
    // magnitude (404.29) does not match the delta (195.71), so the uniform-sign shortcut
    // cannot apply — only the subset-sum search finds this combination.
    const text = `
OpeningBalance £100.00
Date Payment type and details £Paid out £Paid in £Balance
11 Mar 26 SALARY REFUND
CITY 300.00
RENT
CITY 100.00
UTILITY
CITY 3.30
UTILITY2
CITY 0.99 295.71
12 Mar 26 BALANCECARRIEDFORWARD 295.71
`;
    const result = parseStatementText(text);
    expect(result.entries).toHaveLength(4);
    expect(result.unresolvedCount).toBe(0);
    expect(result.entries.every((e) => e.signResolved)).toBe(true);
    expect(result.entries.map((e) => e.amountMinorUnits)).toEqual([30000, -10000, -330, -99]);
  });

  it('flags a genuinely ambiguous same-day batch as unresolved', () => {
    // Two entries of equal value on the same day: either could be the credit.
    const text = `
OpeningBalance £50.00
Date Payment type and details £Paid out £Paid in £Balance
15 Apr 26 SOMETHING
CITY 5.00
SOMETHING ELSE
CITY 5.00 50.00
16 Apr 26 BALANCECARRIEDFORWARD 50.00
`;
    const result = parseStatementText(text);
    expect(result.unresolvedCount).toBe(2);
    expect(result.entries.every((e) => !e.signResolved)).toBe(true);
  });

  it('keeps the table open across a page break via BALANCE BROUGHT FORWARD, closes it via BALANCE CARRIED FORWARD', () => {
    const text = `
OpeningBalance £0.00
Date Payment type and details £Paid out £Paid in £Balance
02 May 26 FIRST PAGE ENTRY
7.77 7.77
03 May 26 BALANCECARRIEDFORWARD 7.77
Your Statement
Date Payment type and details £Paid out £Paid in £Balance
03 May 26 BALANCEBROUGHTFORWARD 7.77
SECOND PAGE ENTRY
2.23 10.00
`;
    const result = parseStatementText(text);
    expect(result.unresolvedCount).toBe(0);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({ date: '2026-05-02', amountMinorUnits: 777, balanceAfterMinorUnits: 777 });
    expect(result.entries[1]).toMatchObject({ date: '2026-05-03', amountMinorUnits: 223, balanceAfterMinorUnits: 1000 });
  });

  it('drops short page-furniture lines without mis-parsing them as transactions', () => {
    const text = `
OpeningBalance £0.00
Date Payment type and details £Paid out £Paid in £Balance
A
.
10 Jun 26 SOME PAYEE
1.50 1.50
11 Jun 26 BALANCECARRIEDFORWARD 1.50
`;
    const result = parseStatementText(text);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].amountMinorUnits).toBe(150);
  });
});

describe('parseStatementCsv', () => {
  it('parses an Amount-column CSV with ISO dates', () => {
    const csv = 'Date,Description,Amount,Balance\n2026-01-05,Coffee Shop,-3.50,96.50\n2026-01-06,Salary,1500.00,1596.50\n';
    const result = parseStatementCsv(csv);
    expect(result.unresolvedCount).toBe(0);
    expect(result.entries).toEqual([
      { date: '2026-01-05', description: 'Coffee Shop', amountMinorUnits: -350, balanceAfterMinorUnits: 9650, signResolved: true },
      { date: '2026-01-06', description: 'Salary', amountMinorUnits: 150000, balanceAfterMinorUnits: 159650, signResolved: true },
    ]);
  });

  it('parses a Debit/Credit-column CSV with DD/MM/YYYY dates', () => {
    const csv = 'Date,Details,Paid out,Paid in\n05/01/2026,Coffee Shop,3.50,\n06/01/2026,Salary,,1500.00\n';
    const result = parseStatementCsv(csv);
    expect(result.entries).toEqual([
      { date: '2026-01-05', description: 'Coffee Shop', amountMinorUnits: -350, balanceAfterMinorUnits: null, signResolved: true },
      { date: '2026-01-06', description: 'Salary', amountMinorUnits: 150000, balanceAfterMinorUnits: null, signResolved: true },
    ]);
  });

  it('throws on unrecognised columns', () => {
    const csv = 'Foo,Bar\n1,2\n';
    expect(() => parseStatementCsv(csv)).toThrow();
  });
});
