/**
 * Reference number shown to people: `BR-` ("borrow record") + number zero-padded to 6 digits
 * (longer numbers are not truncated). Older printouts used `LN-`; those are still accepted by the parser.
 */
export function formatLoanNumber(n: number): string {
  return `BR-${String(n).padStart(6, "0")}`;
}

/**
 * Accepts `BR-000123`, `br-123`, `BR000123`, `123` and the old `LN-000123` / `ln-123` form
 * (surrounding spaces ignored). Null when not a reference number.
 */
export function parseLoanNumber(input: string): number | null {
  const m = /^(?:(?:br|ln)-?)?(\d{1,10})$/i.exec(input.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
}
