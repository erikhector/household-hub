import { createHash } from "crypto";

// SEC-8: password-reset and email-verification links carry a random UUID,
// but the database stores only sha256(uuid). A read-only leak of the token
// tables (backup, replica, SQL injection) therefore can't be turned into an
// account takeover by building /reset-password/<token> URLs. A plain fast
// hash is right here (no salt or bcrypt): the input is 122 bits of CSPRNG
// output, so there is nothing to brute-force, and the lookup must be an
// indexed equality on the `token` column.
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
