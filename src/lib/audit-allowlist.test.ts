import { describe, expect, it } from "vitest";
import { AUDIT_ALLOWLIST, failingAdvisories, judgeAudit, parseAuditReport } from "@/lib/audit-allowlist";

const PICOMATCH = {
  title: "picomatch vulnerable to ReDoS",
  url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
  severity: "high",
};

// Trimmed from the real `npm audit --omit=dev --json` that failed CI
// (DEPS-10): one advisory, reported on the package itself and on the
// packages that depend on it (as names, not advisory objects).
const REPORT = {
  auditReportVersion: 2 as const,
  vulnerabilities: {
    picomatch: { via: [PICOMATCH] },
    "@rollup/pluginutils": { via: ["picomatch"] },
    vite: { via: ["picomatch", "tinyglobby"] },
  },
};

const CLEAN = { auditReportVersion: 2 as const, vulnerabilities: {} };

const ALLOW = [{ id: "GHSA-fc5q-39xc-vjpf", expires: "2027-02-18", reason: "test" }];

describe("failingAdvisories", () => {
  it("collects each high advisory once, ignoring package-name vias", () => {
    expect(failingAdvisories(REPORT)).toEqual([
      { id: "GHSA-fc5q-39xc-vjpf", title: PICOMATCH.title, severity: "high", url: PICOMATCH.url, packages: ["picomatch"] },
    ]);
  });

  it("merges an advisory reported on several packages", () => {
    const report = { auditReportVersion: 2 as const, vulnerabilities: { a: { via: [PICOMATCH] }, b: { via: [PICOMATCH] } } };
    expect(failingAdvisories(report)[0].packages).toEqual(["a", "b"]);
  });

  it("skips low and moderate advisories", () => {
    const report = {
      auditReportVersion: 2 as const,
      vulnerabilities: {
        minimatch: { via: [{ ...PICOMATCH, url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", severity: "moderate" }] },
      },
    };
    expect(failingAdvisories(report)).toEqual([]);
  });

  it("handles a clean report", () => {
    expect(failingAdvisories(CLEAN)).toEqual([]);
  });
});

describe("judgeAudit", () => {
  it("sets aside an allowlisted advisory before it expires", () => {
    const verdict = judgeAudit(REPORT, ALLOW, "2026-11-18");
    expect(verdict.blocking).toEqual([]);
    expect(verdict.allowed.map((a) => a.id)).toEqual(["GHSA-fc5q-39xc-vjpf"]);
    expect(verdict.unused).toEqual([]);
  });

  it("blocks again from the expiry day on", () => {
    expect(judgeAudit(REPORT, ALLOW, "2027-02-18").blocking.map((a) => a.id)).toEqual(["GHSA-fc5q-39xc-vjpf"]);
  });

  it("blocks a critical advisory that isn't listed, alongside an allowed one", () => {
    const other = { title: "x", url: "https://github.com/advisories/GHSA-1111-2222-3333", severity: "critical" };
    const report = { ...REPORT, vulnerabilities: { ...REPORT.vulnerabilities, next: { via: [other] } } };
    const verdict = judgeAudit(report, ALLOW, "2026-11-18");
    expect(verdict.blocking.map((a) => a.id)).toEqual(["GHSA-1111-2222-3333"]);
    expect(verdict.allowed.map((a) => a.id)).toEqual(["GHSA-fc5q-39xc-vjpf"]);
  });

  it("reports an entry whose advisory is gone so it gets deleted", () => {
    const verdict = judgeAudit(CLEAN, ALLOW, "2026-11-18");
    expect(verdict.blocking).toEqual([]);
    expect(verdict.unused).toEqual(ALLOW);
  });

  it("fails closed when npm counts high advisories it couldn't read", () => {
    const report = { ...CLEAN, metadata: { vulnerabilities: { high: 1, critical: 0 } } };
    expect(() => judgeAudit(report, ALLOW, "2026-11-18")).toThrow(/none could be read/);
  });

  it("passes when npm's count agrees with what it read", () => {
    const report = { ...REPORT, metadata: { vulnerabilities: { high: 3, critical: 0 } } };
    expect(judgeAudit(report, ALLOW, "2026-11-18").blocking).toEqual([]);
  });
});

describe("parseAuditReport", () => {
  it("accepts a v2 report", () => {
    expect(parseAuditReport(REPORT)).toBe(REPORT);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["an empty object", {}],
    ["a v1 report", { auditReportVersion: 1, advisories: {} }],
    ["advisories without a version", { advisories: {} }],
    ["a v2 report without vulnerabilities", { auditReportVersion: 2 }],
  ])("rejects %s", (_, json) => {
    expect(() => parseAuditReport(json)).toThrow();
  });

  it("rejects npm's error report", () => {
    expect(() => parseAuditReport({ error: { code: "ENOAUDIT" } })).toThrow(/npm audit failed/);
  });
});

describe("AUDIT_ALLOWLIST", () => {
  it("gives every entry a GHSA id, a reason and an expiry date", () => {
    for (const entry of AUDIT_ALLOWLIST) {
      expect(entry.id).toMatch(/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
      expect(entry.reason.length).toBeGreaterThan(20);
      expect(entry.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
