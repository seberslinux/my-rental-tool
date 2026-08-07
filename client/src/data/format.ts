/**
 * Display formatting — one definition each, used everywhere.
 *
 * These lived in two places and had quietly drifted: the dashboard wrote
 * "R 6.0K" while the calendar wrote "R6.0K" for the same amount, and each
 * file had its own idea of what to do with zero. Guest counts were worse —
 * one path added children to adults and the other did not, so the same
 * booking read as "4 guests" on one screen and "2 guests" on another.
 *
 * Money *calculation* is not done here and is not done in the client at
 * all: gross, deductions and net all arrive computed from the server's
 * calcDeductions. This module only decides how a number looks.
 */

/** `R 6.0K`. Compact by design — these appear in cells and chips. */
export function fmtMoney(amount: number): string {
  if (!amount) return 'R 0';
  if (amount >= 1000000) return `R ${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `R ${(amount / 1000).toFixed(1)}K`;
  return `R ${Math.round(amount)}`;
}

/**
 * Party size, children included.
 *
 * Smoobu's `adults` and `children` are separate fields, and summing only
 * the first undercounts a family: Hill Top Lodge's 2 adults + 2 children
 * showed as "2 guests" while four people were in the house — which is the
 * number that matters for linen, keys and the cleaner's brief.
 */
export function fmtParty(b: { num_guests?: number | null; children?: number | null }): string {
  const adults = b.num_guests ?? null;
  const kids = b.children || 0;
  if (adults === null) return '? guests';
  const total = adults + kids;
  const base = `${total} ${total === 1 ? 'guest' : 'guests'}`;
  return kids > 0 ? `${base} · ${kids} ${kids === 1 ? 'child' : 'children'}` : base;
}
