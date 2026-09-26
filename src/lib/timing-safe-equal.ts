import { timingSafeEqual } from "crypto";

// Constant-time string comparison, shared by every place in this app that
// checks a request-supplied value against a server-side secret or signature
// (the cron routes' bearer token, the weekly digest unsubscribe token's
// HMAC). A plain `===`/`!==` on a secret leaks how many leading characters
// matched through response timing — one comparison at a time until it finds
// the first mismatch — which lets an attacker recover the secret
// byte-by-byte given enough requests. `crypto.timingSafeEqual` closes that,
// but it *throws* on mismatched-length buffers rather than returning false,
// so callers can't just hand it two arbitrary strings.
//
// Different lengths are rejected up front, without calling
// timingSafeEqual — that only leaks the *length* of the expected secret
// (not any of its content), which every one of these callers already leaks
// anyway by the shape of what they issue (a fixed-length HMAC, an env var
// whose length isn't a secret). Equal-length values always take the
// timingSafeEqual path, which compares every byte regardless of where the
// first difference is.
export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}
