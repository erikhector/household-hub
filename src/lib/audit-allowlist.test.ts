import { describe, expect, it } from "vitest";
import { AUDIT_ALLOWLIST, failingAdvisories, judgeAudit } from "@/lib/audit-allowlist";

const PICOMATCH = {
  title: "picomatch vulnerable to ReDoS",
  url: "https://github.com/advisories/GHSA-fc5q-39xc-vjpf",
  severity: "high",
};

// Trimmed from the real `npm audit --omit=dev --json` that failed CI
// (DEPS-10): one advisory, reported on the package itself and on the
// packages that depend on it (as names, not advisory objects).
const REPORT = {
  vulnerabilities: {
    picomatch: { via: [PICOMATCH] },
    "@rollup/pluginutils": { via: ["picomatch"] },
    vite: { via: ["picomatch", "tinyglobby"] },
  },
};

const ALLOW = [{ id: "GHSA-fc5q-39xc-vjpf", expires: "2027-02-18", reason: "test" }];

describe("failingAdvisories", () => {
  it("collects each high advisory once, ignoring package-name vias", () => {
    expect(failingAdvisories(REPORT)).toEqual([
      { id: "GHSA-fc5q-39xc-vjpf", title: PICOMATCH.title, severity: "high", url: PICOMATCH.url, packages: ["picomatch"] },
    ]);
  });

  it("merges an advisory reported on several packages", () => {
    const report = { vulnerabilities: { a: { via: [PICOMATCH] }, b: { via: [PICOMATCH] } } };
    expect(failingAdvisories(report)[0].packages).toEqual(["a", "b"]);
  });

  it("skips low and moderate advisories", () => {
    const report = {
      vulnerabilities: {
        minimatch: { via: [{ ...PICOMATCH, url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc", severity: "moderate" }] },
      },
    };
    expect(failingAdvisories(report)).toEqual([]);
  });

  it("handles a clean report", () => {
    expect(failingAdvisories({ vulnerabilities: {} })).toEqual([]);
    expect(failingAdvisories({})).toEqual([]);
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
    const report = { vulnerabilities: { ...REPORT.vulnerabilities, next: { via: [other] } } };
    const verdict = judgeAudit(report, ALLOW, "2026-11-18");
    expect(verdict.blocking.map((a) => a.id)).toEqual(["GHSA-1111-2222-3333"]);
    expect(verdict.allowed.map((a) => a.id)).toEqual(["GHSA-fc5q-39xc-vjpf"]);
  });

  it("reports an entry whose advisory is gone so it gets deleted", () => {
    const verdict = judgeAudit({ vulnerabilities: {} }, ALLOW, "2026-11-18");
    expect(verdict.blocking).toEqual([]);
    expect(verdict.unused).toEqual(ALLOW);
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
