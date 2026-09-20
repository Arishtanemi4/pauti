import { MatchCandidate, Receipt, StatementLine } from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / MS_PER_DAY;
}

/**
 * Matches statement lines against receipts on amount equality plus date proximity.
 * Returns every candidate above the distance cutoff, scored and sorted best-first — never
 * a single "the" answer, since a tie (two receipts for the same amount on the same day) is
 * the caller's call to resolve, not this function's.
 */
export function matchCandidates(
  statementLines: readonly StatementLine[],
  receipts: readonly Receipt[],
  options: { maxDateDistanceDays?: number } = {}
): MatchCandidate[] {
  const maxDateDistanceDays = options.maxDateDistanceDays ?? 7;
  const candidates: MatchCandidate[] = [];

  for (const line of statementLines) {
    for (const receipt of receipts) {
      if (line.amountMinorUnits !== receipt.amountMinorUnits) continue;

      const distance = daysBetween(line.date, receipt.date);
      if (distance > maxDateDistanceDays) continue;

      const score = 1 - distance / maxDateDistanceDays;
      candidates.push({ statementLineId: line.id, receiptId: receipt.id, score });
    }
  }

  return candidates.sort((a, b) => b.score - a.score);
}
