/**
 * Money in API responses is a structured object, never a bare float (PRD §5.3):
 * `cents` is the exact (possibly fractional) ledger value for chart math, and
 * `formatted` is the human string so every surface renders spend identically.
 */
export interface Money {
  cents: number;
  formatted: string;
}

export function money(cents: number): Money {
  return { cents, formatted: formatCents(cents) };
}

/**
 * Ledger values are fractional cents; caps are whole cents (docs/data-model.md).
 * Amounts from one euro up read as euros (model_pricing.currency is EUR);
 * sub-euro amounts stay in cents with enough precision that a sub-cent LLM call
 * never displays as zero.
 */
export function formatCents(cents: number): string {
  if (Math.abs(cents) >= 100) return `€${(cents / 100).toFixed(2)}`;
  const rounded = Number(cents.toFixed(4));
  return `${rounded}¢`;
}
