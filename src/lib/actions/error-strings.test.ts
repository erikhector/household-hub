import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// UX-16: a Server Action's `{ error }` reaches the user in a toast or under a
// field, so it must be in their language: `await fail("key")` /
// `await zodFail(parsed.error)` (src/lib/actions/errors.ts) or a
// `dict.…` string, never an English literal. This guard keeps the converted
// files that way.
//
// PENDING lists the files not converted yet (MAINT-7 in BACKLOG.md). It is a
// ratchet: the second test fails once a listed file is clean, so the entry
// has to be deleted and the file is guarded from then on.
const PENDING = new Set([
  "src/app/dashboard/budget/actions.ts",
  "src/app/dashboard/personal-budget/actions.ts",
  "src/lib/actions/inventory-scan.ts",
  "src/lib/actions/receipt-scan.ts",
]);

// inventory/items/actions.ts answers with dictionary keys ("invalid",
// "tooMany") that its client dialog maps to text, so a literal there is not
// user-facing English.
const RETURNS_KEYS = new Set(["src/app/dashboard/inventory/items/actions.ts"]);

const root = path.resolve(__dirname, "../../..");

function actionFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir), { recursive: true, encoding: "utf8" })
    .map((f) => path.join(dir, f).split(path.sep).join("/"))
    .filter((f) => {
      if (f.endsWith(".test.ts")) return false;
      const base = path.posix.basename(f);
      const inLibActions = f.startsWith("src/lib/actions/") && base.endsWith(".ts");
      return inLibActions || base === "actions.ts" || base.endsWith("-actions.ts");
    });
}

// `error: "…"`, `error: \`…\``, and Zod's English issue text passed through
// with `?? "Invalid input"`.
const LITERAL_ERROR = /\berror:\s*["'`]|issues\[0\]\?\.message\s*\?\?\s*["'`]/;

function offenders(file: string): string[] {
  return readFileSync(path.join(root, file), "utf8")
    .split("\n")
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line) && LITERAL_ERROR.test(line))
    .map(({ line, n }) => `${file}:${n}: ${line.trim()}`);
}

const files = [...actionFiles("src/app"), ...actionFiles("src/lib/actions")];

describe("server-action error strings are translated", () => {
  it("scans the action files", () => {
    expect(files.length).toBeGreaterThan(20);
    for (const pending of PENDING) expect(files).toContain(pending);
  });

  it("returns no string-literal error from a converted action file", () => {
    const found = files
      .filter((f) => !PENDING.has(f) && !RETURNS_KEYS.has(f))
      .flatMap(offenders);
    expect(found).toEqual([]);
  });

  it("has no entry in PENDING for a file that is already clean", () => {
    const clean = [...PENDING].filter((f) => offenders(f).length === 0);
    expect(clean).toEqual([]);
  });
});
