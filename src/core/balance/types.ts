/** A directed debt: `from` owes `to` this amount. */
export interface Debt {
  readonly from: string;
  readonly to: string;
  readonly amountMinorUnits: number;
}

/** A resolved payment that settles part of a net balance. */
export interface Settlement {
  readonly from: string;
  readonly to: string;
  readonly amountMinorUnits: number;
}
