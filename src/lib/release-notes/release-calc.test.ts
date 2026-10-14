import { describe, expect, it } from "vitest";
import {
  bumpVersion,
  compareVersions,
  extractReleaseNotes,
  parsePrTitle,
  planRelease,
  planTrainRelease,
  parseTrainLog,
} from "@/lib/release-notes/release-calc";

const TEMPLATE_BODY = `## Summary

Adds a thing.

## Release note

<!-- Shown to users under "What's new". -->

### English

<!-- One or two plain sentences. -->
You can now scan barcodes from the shopping list.

### Svenska

<!-- Samma sak på svenska. -->
Du kan nu skanna streckkoder från inköpslistan.
`;

describe("parsePrTitle", () => {
  it("parses type, scope, breaking marker and description", () => {
    expect(parsePrTitle("feat(shopping): barcode scan")).toEqual({
      kind: "feat",
      scope: "shopping",
      breaking: false,
      description: "barcode scan",
    });
    expect(parsePrTitle("fix!: drop old export format")?.breaking).toBe(true);
  });

  it("rejects titles that aren't Conventional Commits", () => {
    expect(parsePrTitle("Add barcode scan")).toBeNull();
    expect(parsePrTitle("feature: barcode scan")).toBeNull();
    expect(parsePrTitle("feat:no space")).toBeNull();
  });
});

describe("bumpVersion", () => {
  it("bumps each part and resets the lower ones", () => {
    expect(bumpVersion("1.4.2", "patch")).toBe("1.4.3");
    expect(bumpVersion("1.4.2", "minor")).toBe("1.5.0");
    expect(bumpVersion("1.4.2", "major")).toBe("2.0.0");
  });

  it("refuses prerelease or malformed versions", () => {
    expect(() => bumpVersion("1.0.0-beta.1", "patch")).toThrow();
  });
});

describe("compareVersions", () => {
  it("compares numerically, not lexically", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
  });
});

describe("extractReleaseNotes", () => {
  it("reads both languages and ignores template comments", () => {
    expect(extractReleaseNotes(TEMPLATE_BODY, "fallback")).toEqual({
      en: "You can now scan barcodes from the shopping list.",
      sv: "Du kan nu skanna streckkoder från inköpslistan.",
    });
  });

  it("falls back to the title when the template was left empty", () => {
    const empty = "### English\n\n<!-- write here -->\n\n### Svenska\n\n<!-- här -->\n";
    expect(extractReleaseNotes(empty, "Barcode scan")).toEqual({ en: "Barcode scan", sv: null });
    expect(extractReleaseNotes(null, "Barcode scan")).toEqual({ en: "Barcode scan", sv: null });
  });

  it("handles CRLF bodies from the GitHub web editor", () => {
    const crlf = TEMPLATE_BODY.replace(/\n/g, "\r\n");
    expect(extractReleaseNotes(crlf, "x").en).toBe("You can now scan barcodes from the shopping list.");
  });
});

describe("planRelease", () => {
  const base = { body: TEMPLATE_BODY, pr: 42, currentVersion: "0.3.1", date: new Date("2026-09-23T18:00:00Z") };

  it("feat → minor release with the PR's notes", () => {
    const plan = planRelease({ ...base, title: "feat(shopping): barcode scan" });
    expect(plan).toMatchObject({
      status: "release",
      type: "minor",
      entry: { version: "0.4.0", date: "2026-09-23", pr: 42, kind: "feat", breaking: false },
    });
  });

  it("fix → patch, breaking → major", () => {
    expect(planRelease({ ...base, title: "fix: rounding" })).toMatchObject({ entry: { version: "0.3.2" } });
    expect(planRelease({ ...base, title: "refactor!: new data model" })).toMatchObject({
      type: "major",
      entry: { version: "1.0.0", breaking: true },
    });
  });

  it("internal types merge without a release", () => {
    expect(planRelease({ ...base, title: "docs: tidy README" }).status).toBe("no-release");
    expect(planRelease({ ...base, title: "chore(deps): bump next" }).status).toBe("no-release");
  });

  it("flags an invalid title", () => {
    expect(planRelease({ ...base, title: "Barcode scan" }).status).toBe("invalid-title");
  });
});

describe("parseTrainLog", () => {
  it("reads squash-merge PR numbers oldest first and marks sync merges", () => {
    const log = [
      "aaaaaaa fix: rounding (#12)",
      "bbbbbbb chore: sync master into next [skip ci]",
      "ccccccc feat(shopping): barcode scan (#10)",
      "ddddddd docs: tidy README (#9)",
      "",
    ].join("\n");
    expect(parseTrainLog(log)).toEqual([
      { sha: "ddddddd", pr: 9, sync: false },
      { sha: "ccccccc", pr: 10, sync: false },
      { sha: "bbbbbbb", pr: null, sync: true },
      { sha: "aaaaaaa", pr: 12, sync: false },
    ]);
  });

  it("ignores a PR number mentioned mid-subject", () => {
    expect(parseTrainLog("eeeeeee revert: undo #4 (#5)")).toEqual([
      { sha: "eeeeeee", pr: 5, sync: false },
    ]);
  });

  // Regression: release #211 shipped two PRs squash-merged with their bare
  // title as the commit title. They came back as "no PR" and were skipped,
  // so the release had no feat and cut nothing.
  it("leaves a squash commit without (#N) for a lookup instead of dropping it", () => {
    expect(parseTrainLog("48ce158 feat: loading skeletons for every dashboard page (UX-42)")).toEqual([
      { sha: "48ce158", pr: null, sync: false },
    ]);
  });
});

describe("planTrainRelease", () => {
  const base = { pr: 99, currentVersion: "0.3.1", date: new Date("2026-10-14T08:00:00Z") };
  const note = (en: string, sv?: string) =>
    `## Release note\n\n### English\n\n${en}\n\n### Svenska\n\n${sv ?? ""}\n`;

  it("takes the biggest bump and joins the releasing PRs' notes in order", () => {
    const plan = planTrainRelease({
      ...base,
      prs: [
        { number: 1, title: "fix: rounding", body: note("Rounding is fixed.", "Avrundningen är fixad.") },
        { number: 2, title: "docs: tidy README", body: note("Ignored.") },
        { number: 3, title: "feat(shopping): barcode scan", body: note("Scan barcodes.") },
      ],
    });
    expect(plan).toMatchObject({
      status: "release",
      type: "minor",
      entry: { version: "0.4.0", date: "2026-10-14", pr: 99, kind: "feat", breaking: false },
    });
    if (plan.status !== "release") throw new Error("expected a release");
    expect(plan.entry.notes).toEqual({
      en: "Rounding is fixed.\n\nScan barcodes.",
      sv: "Avrundningen är fixad.\n\nScan barcodes.",
    });
    expect(plan.items.map((i) => i.type)).toEqual(["patch", null, "minor"]);
  });

  it("any breaking PR makes it a major release", () => {
    const plan = planTrainRelease({
      ...base,
      prs: [
        { number: 1, title: "feat: thing", body: null },
        { number: 2, title: "refactor!: new data model", body: null },
      ],
    });
    expect(plan).toMatchObject({ type: "major", entry: { version: "1.0.0", breaking: true } });
  });

  it("keeps the Swedish note null when no PR wrote one", () => {
    const plan = planTrainRelease({ ...base, prs: [{ number: 1, title: "fix: rounding", body: null }] });
    expect(plan).toMatchObject({ entry: { notes: { en: "Rounding", sv: null } } });
  });

  it("only internal or invalid titles ship nothing", () => {
    const plan = planTrainRelease({
      ...base,
      prs: [
        { number: 1, title: "chore: bump deps", body: null },
        { number: 2, title: "Not conventional", body: null },
      ],
    });
    expect(plan.status).toBe("no-release");
  });
});
