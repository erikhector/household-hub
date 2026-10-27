// Swish helpers for GAP-7's "Pay with Swish" link on the Budget page's
// "Who owes whom" card (src/components/budget/household-balances.tsx). All
// pure, so they're unit-tested in swish.test.ts without a phone.
//
// The link is Swish's app-switch deep link, `swish://payment?data=<JSON>`,
// which pre-fills a private payment in the Swish app with no merchant
// agreement or API key. It isn't in Swish's public developer docs (those
// only cover the merchant `swish://paymentrequest?token=` flow), so the
// shape below follows how it's used in the wild and the gotchas people
// have hit (https://gist.github.com/Armandur/ead542b56cca2696b4286dbc05740da8):
//  - `version` must be the *number* 1 — the string "1.0" opens an empty
//    payment view.
//  - `payee.value` must be a Swish alias: for a private person that's the
//    mobile number with country code and no leading zero ("46701234567").
//    The locally written "0701234567" is rejected with "Felaktig länk".
//  - `amount.value` is a number with a decimal point, never a comma, and
//    zero/empty is rejected — an unknown amount means omitting the key,
//    which this app never needs to do.
//  - `message.value` is capped at 50 characters in the app.
//  - Leaving any field editable also makes the payee editable, so every
//    field is locked: the link is meant to pay exactly this debt to exactly
//    this person. A partial repayment is still possible by cancelling and
//    paying by hand, then recording it with "Clear debt".
// Tapping the link never records anything in the app — money changes stay
// an explicit user action (BACKLOG.md's Guardrails), so the payer still
// uses "Clear debt" once the Swish payment has gone through.

// Swish only moves Swedish kronor. Callers check swishSupportsCurrency
// against the household's display currency (GAP-13's
// Household.currencyCode), falling back to HOUSEHOLD_BASE_CURRENCY
// (src/lib/currency.ts) when it's unset, so the link shows only for a SEK
// or unset household.
const SWISH_CURRENCY = "SEK";

export function swishSupportsCurrency(currencyCode: string): boolean {
  return currencyCode.toUpperCase() === SWISH_CURRENCY;
}

const SWISH_MESSAGE_MAX_LENGTH = 50;

// Returned by updateSwishNumberAction (src/app/dashboard/profile/actions.ts)
// for an unparseable number. The form swaps it for the translated message,
// the same way the rest of that file's English-only errors reach the user.
export const INVALID_SWISH_NUMBER_ERROR = "Enter a Swedish mobile number, like 070-123 45 67";

/**
 * Normalizes a Swedish mobile number as typed into Swish's alias format,
 * "467XXXXXXXX". Accepts 07XXXXXXXX, +467XXXXXXXX, 00467XXXXXXXX and
 * 467XXXXXXXX, with any spaces, hyphens, dots or parentheses — and the
 * "+46 (0)70…" form, whose redundant trunk zero is dropped. Returns null for
 * anything else, including landlines: Swish for private persons is tied to a
 * mobile number, and every Swedish mobile number is 07 followed by 8 digits.
 */
export function normalizeSwishNumber(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  // Only allow the characters a person actually types into a phone number;
  // anything else (letters, a second "+") means it isn't one.
  if (!/^\+?[\d\s\-().]+$/.test(trimmed)) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  let national: string;
  if (hasPlus) {
    if (!digits.startsWith("46")) return null;
    national = digits.slice(2);
  } else if (digits.startsWith("0046")) {
    national = digits.slice(4);
  } else if (digits.startsWith("46")) {
    national = digits.slice(2);
  } else if (digits.startsWith("0")) {
    national = digits.slice(1);
  } else {
    return null;
  }
  // "+46 (0)70 123 45 67" → "0701234567" after the country code.
  if (national.startsWith("0")) national = national.slice(1);

  if (!/^7\d{8}$/.test(national)) return null;
  return `46${national}`;
}

/**
 * Renders a stored alias ("46701234567") the way Swedes write a mobile
 * number ("070-123 45 67"). Anything that isn't a valid alias is returned
 * unchanged rather than mangled.
 */
export function formatSwishNumber(alias: string): string {
  if (!/^467\d{8}$/.test(alias)) return alias;
  const n = `0${alias.slice(2)}`; // 0701234567
  return `${n.slice(0, 3)}-${n.slice(3, 6)} ${n.slice(6, 8)} ${n.slice(8)}`;
}

/**
 * Trims a payment message down to what the Swish app accepts: letters
 * (including å/ä/ö and common accented ones), digits, spaces and the
 * punctuation :;.,?!() — anything else is dropped — capped at 50
 * characters. Swish rejects the whole link over a single disallowed
 * character, so this errs on the side of stripping.
 */
export function sanitizeSwishMessage(message: string): string {
  return message
    .replace(/[^A-Za-z0-9ÅÄÖåäöÉéÜü :;.,?!()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SWISH_MESSAGE_MAX_LENGTH)
    .trim();
}

/**
 * Builds the `swish://payment?data=…` link that opens the Swish app with the
 * payee, amount and message filled in and locked. Returns null when there's
 * nothing sensible to link to — an invalid payee or an amount that doesn't
 * round to at least 0.01 kr — so the caller just doesn't render a link.
 */
export function buildSwishPaymentUrl({
  payee,
  amount,
  message,
}: {
  payee: string;
  amount: number;
  message: string;
}): string | null {
  const alias = normalizeSwishNumber(payee);
  if (!alias) return null;
  if (!Number.isFinite(amount)) return null;
  // Swish takes at most two decimals; round rather than truncate so a
  // balance like 333.335 from an uneven split doesn't come out a öre short.
  const rounded = Math.round(amount * 100) / 100;
  if (rounded <= 0) return null;

  const data: Record<string, unknown> = {
    version: 1,
    payee: { value: alias, editable: false },
    amount: { value: rounded, editable: false },
  };
  const cleanMessage = sanitizeSwishMessage(message);
  if (cleanMessage) data.message = { value: cleanMessage, editable: false };

  return `swish://payment?data=${encodeURIComponent(JSON.stringify(data))}`;
}

/**
 * The Swish numbers the Budget page hands to the "Who owes whom" card: only
 * those of members the signed-in member (`payerMemberId`) currently owes a
 * positive amount. Everyone's number is visible to their household by
 * design (the Profile page says so), but there's no reason to ship numbers
 * to the browser that no link on the page needs. Empty when Swish can't
 * carry the household's currency.
 */
export function swishNumbersForPayer({
  settlements,
  payerMemberId,
  members,
  currencyCode,
}: {
  settlements: { fromMemberId: string; toMemberId: string; amount: number }[];
  payerMemberId: string;
  members: { id: string; swishNumber: string | null }[];
  currencyCode: string;
}): Record<string, string> {
  if (!payerMemberId || !swishSupportsCurrency(currencyCode)) return {};
  const result: Record<string, string> = {};
  for (const s of settlements) {
    if (s.fromMemberId !== payerMemberId || !(s.amount > 0)) continue;
    const number = members.find((m) => m.id === s.toMemberId)?.swishNumber;
    if (number) result[s.toMemberId] = number;
  }
  return result;
}
