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
