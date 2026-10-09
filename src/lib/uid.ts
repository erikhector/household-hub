// UX-29: `crypto.randomUUID()` throws in insecure contexts — plain-HTTP LAN
// testing included (`crypto` itself may even be undefined there) — so any
// client-side id takes this instead of calling it directly. Same v4 layout
// either way; the fallback is only ever a form-row key, never a secret.

export function newUid(): string {
  try {
    const uuid = (globalThis.crypto as Crypto | undefined)?.randomUUID?.();
    if (typeof uuid === "string" && uuid.length > 0) return uuid;
  } catch {
    // Insecure context: fall through to the manual v4 below.
  }
  const bytes = new Uint8Array(16);
  const randomValues = (globalThis.crypto as Crypto | undefined)?.getRandomValues?.bind(globalThis.crypto);
  if (randomValues) {
    randomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
