// Date-range math for the Home screen's single switchable D/W/M/Y component
// (docs/plan/EXECUTE.md §5.1). Pure date arithmetic — no React, no I/O, no wall-clock reads;
// the reference date is always passed in, never read from Date.now() internally, so this is
// deterministic and testable.

export type Period = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface DateRange {
  /** ISO 8601 date, inclusive. */
  startDate: string;
  /** ISO 8601 date, inclusive. */
  endDate: string;
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The [startDate, endDate] window a period covers, anchored on referenceDate. Weeks start Sunday. */
export function periodRange(period: Period, referenceDate: Date): DateRange {
  const y = referenceDate.getFullYear();
  const m = referenceDate.getMonth();
  const d = referenceDate.getDate();

  switch (period) {
    case 'DAILY': {
      const iso = toIsoDate(referenceDate);
      return { startDate: iso, endDate: iso };
    }
    case 'WEEKLY': {
      const dayOfWeek = referenceDate.getDay();
      const start = new Date(y, m, d - dayOfWeek);
      const end = new Date(y, m, d - dayOfWeek + 6);
      return { startDate: toIsoDate(start), endDate: toIsoDate(end) };
    }
    case 'MONTHLY': {
      const start = new Date(y, m, 1);
      const end = new Date(y, m + 1, 0);
      return { startDate: toIsoDate(start), endDate: toIsoDate(end) };
    }
    case 'YEARLY': {
      const start = new Date(y, 0, 1);
      const end = new Date(y, 11, 31);
      return { startDate: toIsoDate(start), endDate: toIsoDate(end) };
    }
  }
}
