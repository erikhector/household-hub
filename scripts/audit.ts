// CI's production dependency audit (the "Audit production dependencies"
// step in .github/workflows/ci.yml), run directly under Node's built-in
// TypeScript type stripping like scripts/release.ts.
//
//   node scripts/audit.ts
//
// Same scope as `npm audit --omit=dev --audit-level=high` (only what
// ships, only high or critical), but an advisory with no fix yet can be
// set aside for a while in src/lib/audit-allowlist.ts, which says why
// (DEPS-10). Exits 1 on any other high or critical advisory, or on an
// allowlisted one whose entry has expired.
import { spawnSync } from "node:child_process";
import { AUDIT_ALLOWLIST, judgeAudit } from "../src/lib/audit-allowlist.ts";

// `npm audit` exits 1 whenever it finds anything, so the exit code says
// nothing here; the JSON on stdout does. No JSON means the audit itself
// failed (registry down, …), which must fail the step too.
const run = spawnSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error("npm audit produced no JSON report:\n" + run.stderr + run.stdout);
  process.exit(1);
}
if (report.error) {
  console.error("npm audit failed: " + JSON.stringify(report.error));
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const { blocking, allowed, unused } = judgeAudit(report, AUDIT_ALLOWLIST, today);

for (const a of allowed) {
  const entry = AUDIT_ALLOWLIST.find((e) => e.id.toUpperCase() === a.id.toUpperCase());
  console.log(`Allowed until ${entry?.expires}: ${a.severity} ${a.id} (${a.packages.join(", ")}) ${a.title}`);
}
for (const e of unused) {
  console.log(`No longer reported, delete its entry in src/lib/audit-allowlist.ts: ${e.id}`);
}
if (blocking.length) {
  console.error(`\n${blocking.length} high or critical advisor${blocking.length === 1 ? "y" : "ies"} in production dependencies:`);
  for (const a of blocking) console.error(`  ${a.severity} ${a.id} in ${a.packages.join(", ")}: ${a.title} ${a.url}`);
  console.error("\nFix with `npm audit fix` or an `overrides` entry. If no patched release exists, see src/lib/audit-allowlist.ts.");
  process.exit(1);
}
console.log("No unallowed high or critical advisories in production dependencies.");
