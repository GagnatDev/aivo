/** Rows one CSV export will carry before truncating (bounds memory). */
export const EXPORT_MAX_ROWS = 50_000;

/** Quote a CSV field only when it needs it (comma, quote, or newline). */
export function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
