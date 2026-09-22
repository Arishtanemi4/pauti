// Currency-aware formatting. Money is always carried as an integer count of minor units
// (paise, cents, ...); this is the only place that divides back down to a display value,
// and it asks Intl for the currency's actual minor-unit exponent rather than assuming 2
// (JPY has 0, BHD has 3).

export function formatMinorUnits(amountMinorUnits: number, currency: string, locale = 'en-US'): string {
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const minorUnitDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  const divisor = 10 ** minorUnitDigits;
  return formatter.format(amountMinorUnits / divisor);
}

/**
 * Inverse of {@link formatMinorUnits}: parses a plain decimal string ("12.50") as typed into
 * a form field into integer minor units for the given currency. Throws on non-numeric input.
 */
export function parseToMinorUnits(input: string, currency: string, locale = 'en-US'): number {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid amount: ${input}`);
  }
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const minorUnitDigits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return Math.round(value * 10 ** minorUnitDigits);
}
