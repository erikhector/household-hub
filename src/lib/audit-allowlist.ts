// Pure logic for CI's production dependency audit (scripts/audit.ts, run
// by the "Audit production dependencies" step in .github/workflows/ci.yml).
//
// `npm audit --audit-level=high` has no way to set aside one advisory, so
// a high advisory with no patched release anywhere turns every PR red
// until upstream ships a fix (DEPS-10: picomatch's ReDoS, where 4.0.7 is
// both the latest release and still vulnerable). The script runs
// `npm audit --json` instead and fails on every high or critical advisory
// except the ones listed in AUDIT_ALLOWLIST below. Each entry carries the
// reason it's safe to ship and an expiry date, so an entry nobody revisits
// turns CI red again instead of hiding the advisory for good.
//
// Import-free and free of enums/namespaces, like release-calc.ts: the
// script runs this file directly under Node's TypeScript type stripping,
// which can't resolve the `@/` alias.

export type AllowlistEntry = {
  /** The advisory's GHSA id, as in its github.com/advisories URL. */
  id: string;
  /** YYYY-MM-DD, UTC. From this day on the entry no longer applies. */
  expires: string;
  /** Why shipping with it is safe meanwhile, and what clears it. */
  reason: string;
};

export const AUDIT_ALLOWLIST: AllowlistEntry[] = [];

export type Advisory = { id: string; title: string; severity: string; url: string; packages: string[] };

// The slice of `npm audit --json` (npm 7+, auditReportVersion 2) read here.
// Each vulnerable package's `via` lists either advisory objects (the package
// itself is affected) or names of other packages (affected through them).
type AuditVia = string | { title?: string; url?: string; severity?: string };
type AuditReport = {
  auditReportVersion: 2;
  vulnerabilities: Record<string, { via?: AuditVia[] }>;
  metadata?: { vulnerabilities?: Record<string, number> };
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The parsed `npm audit --json` output, checked to be the report shape read
 * here. Throws on anything else ({}, null, an `error` report, npm 6's v1
 * `advisories` shape, …): reading those as "no vulnerabilities" would turn
 * the gate green on an audit that never ran, so it fails closed instead.
 */
export function parseAuditReport(json: unknown): AuditReport {
  if (!isObject(json)) throw new Error("npm audit output is not a JSON object");
  if ("error" in json) throw new Error("npm audit failed: " + JSON.stringify(json.error));
  if (json.auditReportVersion !== 2) {
    throw new Error(`unsupported npm audit report version: ${JSON.stringify(json.auditReportVersion)}`);
  }
  if (!isObject(json.vulnerabilities)) throw new Error("npm audit report has no vulnerabilities object");
  return json as AuditReport;
}

const FAILING = new Set(["high", "critical"]);

/** The advisory id from its URL (…/advisories/GHSA-xxxx-xxxx-xxxx), or the URL. */
function advisoryId(url: string): string {
  return url.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i)?.[0] ?? url;
}

/** Every high or critical advisory in the report, once each, with the packages it's reported on. */
export function failingAdvisories(report: AuditReport): Advisory[] {
  const byId = new Map<string, Advisory>();
  for (const [pkg, vuln] of Object.entries(report.vulnerabilities)) {
    for (const via of vuln.via ?? []) {
      if (typeof via === "string" || !via.severity || !FAILING.has(via.severity)) continue;
      const url = via.url ?? "";
      const id = advisoryId(url || via.title || pkg);
      const found = byId.get(id);
      if (found) {
        if (!found.packages.includes(pkg)) found.packages.push(pkg);
      } else {
        byId.set(id, { id, title: via.title ?? "", severity: via.severity, url, packages: [pkg] });
      }
    }
  }
  return [...byId.values()];
}

export type AuditVerdict = {
  /** Fail the build: not allowlisted, or its entry has expired. */
  blocking: Advisory[];
  /** Present but set aside by a current allowlist entry. */
  allowed: Advisory[];
  /** Entries for advisories no longer reported: delete them. */
  unused: AllowlistEntry[];
};

/** Splits the report's failing advisories by the allowlist as of `today` (YYYY-MM-DD). */
export function judgeAudit(report: AuditReport, allowlist: AllowlistEntry[], today: string): AuditVerdict {
  const advisories = failingAdvisories(report);
  // npm's own count is a second opinion: if it counts high or critical
  // packages but no advisory object above was read as one (a severity
  // spelled differently, a missing field), fail rather than pass.
  const counts = report.metadata?.vulnerabilities ?? {};
  if ((counts.high ?? 0) + (counts.critical ?? 0) > 0 && advisories.length === 0) {
    throw new Error("npm audit counts high or critical vulnerabilities, but none could be read from the report");
  }
  const current = new Set(allowlist.filter((e) => today < e.expires).map((e) => e.id.toUpperCase()));
  const reported = new Set(advisories.map((a) => a.id.toUpperCase()));
  return {
    blocking: advisories.filter((a) => !current.has(a.id.toUpperCase())),
    allowed: advisories.filter((a) => current.has(a.id.toUpperCase())),
    unused: allowlist.filter((e) => !reported.has(e.id.toUpperCase())),
  };
}
