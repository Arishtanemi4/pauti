/** A per-currency amount. Balances are never summed across currencies — see docs/architecture.md. */
export interface CurrencyAmount {
  readonly currency: string;
  readonly amountMinorUnits: number;
}
