export interface StatementLine {
  readonly id: string;
  readonly amountMinorUnits: number;
  /** ISO 8601 date, e.g. '2026-01-15'. */
  readonly date: string;
}

export interface Receipt {
  readonly id: string;
  readonly amountMinorUnits: number;
  readonly date: string;
}

export interface MatchCandidate {
  readonly statementLineId: string;
  readonly receiptId: string;
  /** 1.0 for a same-day match, decaying towards 0 as the dates drift apart. */
  readonly score: number;
}
