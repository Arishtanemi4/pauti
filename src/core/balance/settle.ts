// Settlement allocation (docs/plan/EXECUTE.md §5.2, ADR-006): a settle-up payment is applied
// oldest-outstanding-first, regardless of which group each split belongs to. This is what
// lets "settle here, reflects in the group" need no extra code — a settlement's allocations
// simply reference splits by scope key, wherever they live.

export interface OutstandingSplit {
  readonly scopeKey: string;
  readonly outstandingAmountMinorUnits: number;
}

export interface SettlementAllocation {
  readonly scopeKey: string;
  readonly amountMinorUnits: number;
}

/**
 * Distributes a settlement payment across `outstanding`, oldest-first. `outstanding` must
 * already be ordered oldest to newest by the caller — this function only distributes, it
 * never reorders.
 */
export function allocateSettlement(
  amountMinorUnits: number,
  outstanding: readonly OutstandingSplit[]
): SettlementAllocation[] {
  if (amountMinorUnits <= 0) {
    throw new Error('Settlement amount must be greater than zero');
  }

  let remaining = amountMinorUnits;
  const allocations: SettlementAllocation[] = [];
  for (const split of outstanding) {
    if (remaining <= 0) break;
    const amount = Math.min(remaining, split.outstandingAmountMinorUnits);
    allocations.push({ scopeKey: split.scopeKey, amountMinorUnits: amount });
    remaining -= amount;
  }

  if (remaining > 0) {
    throw new Error('Settlement amount exceeds total outstanding balance');
  }

  return allocations;
}
