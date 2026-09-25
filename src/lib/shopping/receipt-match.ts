// Pure receipt-line → item matching for the two receipt dialogs (AUTO-11):
// src/components/shopping/receipt-scan-dialog.tsx (lines → pending items on
// an existing list) and register-receipt-dialog.tsx (lines → inventory
// items). Both used to run findInventoryMatches with a single pre-select
// threshold and then show every line open for review, which meant a
// 25-line receipt where 20 lines matched perfectly still took 25 looks.
//
// There are now two thresholds:
// - RECEIPT_PRESELECT_MIN_SCORE (unchanged from before): above it the best
//   match is pre-selected in the row's picker, but the row stays open for
//   the user to confirm.
// - RECEIPT_AUTO_ACCEPT_MIN_SCORE, much stricter: above it (and with a
//   clear margin over the runner-up) the line is pre-accepted and the
//   dialog collapses it into an expandable "N items matched" summary.
//
// "Pre-accepted" is purely a presentation state. Nothing is written until
// the user presses the dialog's one Apply button, and every collapsed line
// is still one tap away — that's what keeps this inside the Guardrails'
// "suggest, don't silently mutate" rule: the review step still exists, it
// just starts shorter.
//
// A line that carries a barcode (receiptLineBarcode, src/lib/barcode.ts)
// equal to exactly one candidate's stored barcode (AUTO-6) is the strongest
// signal there is, so it's accepted regardless of how differently the
// receipt abbreviates the name ("MJÖLK 3% 1L" vs "Mellanmjölk").
//
// Kept dependency-free (bar the other pure matchers) so it can run in the
// client dialogs and be unit-tested without mocks.

import { receiptLineBarcode } from "@/lib/barcode";
import { findInventoryMatches, type InventoryMatchCandidate } from "@/lib/item-matching";

// Below this, defaulting to "skip"/"create new" is safer than confidently
// linking the wrong item — the user can still pick one manually. Same value
// both dialogs used before AUTO-11.
export const RECEIPT_PRESELECT_MIN_SCORE = 0.35;

// Deliberately close to "the same name after normalization" (which scores
// exactly 1): bigram similarity puts ordinary near-misses like "Tomatoes"
// vs "tomato" around 0.83, and a plural/singular slip is exactly the kind
// of thing that should still get a glance. Swedish receipts abbreviate
// names heavily, so in practice most fuzzy auto-accepts are exact-name
// hits and the barcode path does the rest. Tune against real receipts
// before loosening — a wrong auto-accept costs more than an extra look.
export const RECEIPT_AUTO_ACCEPT_MIN_SCORE = 0.9;

// Even a high score isn't confident when a second candidate is nearly as
// good — most often two items with the same name (a list with "Milk" on it
// twice, or inventory items "Mjölk" and "mjölk." that only differ in case
// and punctuation, which both score 1). Which one the user meant is a
// genuine choice, so the line stays open.
export const RECEIPT_AUTO_ACCEPT_MIN_MARGIN = 0.15;

export type ReceiptMatchCandidate = InventoryMatchCandidate & { barcode?: string | null };

export type ReceiptLineInput = { name: string; barcode?: string | null };

/**
 * - `barcode`: the line's barcode equals exactly one candidate's — accepted.
 * - `confident`: fuzzy name match above the auto-accept bar — accepted.
 * - `suggested`: a best guess is pre-selected, but the line needs review.
 * - `none`: nothing close enough; the line needs review with no guess.
 */
export type ReceiptMatchConfidence = "barcode" | "confident" | "suggested" | "none";

export type ReceiptLineMatch = { matchId: string | null; confidence: ReceiptMatchConfidence };

export function isAutoAccepted(match: ReceiptLineMatch): boolean {
  return match.confidence === "barcode" || match.confidence === "confident";
}

/** Matches one receipt line against the candidates — see the file comment
 * for what each confidence level means. */
export function matchReceiptLine(line: ReceiptLineInput, candidates: ReceiptMatchCandidate[]): ReceiptLineMatch {
  const barcode = receiptLineBarcode(line.barcode);
  if (barcode) {
    const byBarcode = candidates.filter((candidate) => candidate.barcode === barcode);
    // Two candidates with the same code only happens on a shopping list
    // with two rows for the same inventory item — a real match, but which
    // row is a guess, so pre-select the first and leave it open.
    if (byBarcode.length === 1) return { matchId: byBarcode[0].id, confidence: "barcode" };
    if (byBarcode.length > 1) return { matchId: byBarcode[0].id, confidence: "suggested" };
  }

  const [best, runnerUp] = findInventoryMatches(line.name, candidates, {
    limit: 2,
    minScore: RECEIPT_PRESELECT_MIN_SCORE,
  });
  if (!best) return { matchId: null, confidence: "none" };

  const clearWinner = !runnerUp || best.score - runnerUp.score >= RECEIPT_AUTO_ACCEPT_MIN_MARGIN;
  if (best.score >= RECEIPT_AUTO_ACCEPT_MIN_SCORE && clearWinner) {
    return { matchId: best.id, confidence: "confident" };
  }
  return { matchId: best.id, confidence: "suggested" };
}

/**
 * Matches every line of a receipt. With `exclusive` (ReceiptScanDialog:
 * each pending list row can only be bought once per receipt), two lines
 * that both auto-accept the same candidate are both demoted to `suggested`
 * — one of them is wrong, and only the user can say which. Without it
 * (RegisterReceiptDialog), two lines for the same inventory item are
 * normal: the same product scanned twice on one receipt.
 */
export function matchReceiptLines(
  lines: ReceiptLineInput[],
  candidates: ReceiptMatchCandidate[],
  { exclusive = false }: { exclusive?: boolean } = {},
): ReceiptLineMatch[] {
  const matches = lines.map((line) => matchReceiptLine(line, candidates));
  if (!exclusive) return matches;

  const acceptedCount = new Map<string, number>();
  for (const match of matches) {
    if (isAutoAccepted(match) && match.matchId) {
      acceptedCount.set(match.matchId, (acceptedCount.get(match.matchId) ?? 0) + 1);
    }
  }
  return matches.map((match) =>
    isAutoAccepted(match) && match.matchId && (acceptedCount.get(match.matchId) ?? 0) > 1
      ? { ...match, confidence: "suggested" }
      : match,
  );
}
