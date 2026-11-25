import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// UX-16: a Server Action's `{ error }` reaches the user in a toast or under a
// field, so it must be in their language: `await fail("key")` /
// `await zodFail(parsed.error)` (src/lib/actions/errors.ts) or a
// `dict.…` string, never an English literal. This guard keeps every action
// file that way (MAINT-7 converted the last of them).

// These answer with codes that their client dialogs map to text, so a
// literal there is not user-facing English: inventory/items/actions.ts
// ("invalid", "tooMany"), and the two photo scans ("not_configured",
// "rate_limited", "photo_too_large", "invalid_photo"), which
// ai-shelf-scan-dialog.tsx and receipt-scan-dialog.tsx turn into
// `dict` strings.
const RETURNS_KEYS = new Set([
  "src/app/dashboard/inventory/items/actions.ts",
  "src/lib/actions/inventory-scan.ts",
  "src/lib/actions/receipt-scan.ts",
]);

const root = path.resolve(__dirname, "../../..");

function actionFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir), { recursive: true, encoding: "utf8" })
    .map((f) => path.join(dir, f).split(path.sep).join("/"))
    .filter((f) => {
      if (f.endsWith(".test.ts")) return false;
      const base = path.posix.basename(f);
      const inLibActions = f.startsWith("src/lib/actions/") && base.endsWith(".ts");
      // `action-helpers.ts` holds the shared helpers of a feature's split
      // action files (MAINT-110), whose `{ error }` the actions pass on.
      return (
        inLibActions ||
        base === "actions.ts" ||
        base.endsWith("-actions.ts") ||
        base === "action-helpers.ts"
      );
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
    expect(files).toContain("src/app/dashboard/budget/category-actions.ts");
    expect(files).toContain("src/app/dashboard/budget/action-helpers.ts");
  });

  it("returns no string-literal error from an action file", () => {
    const found = files.filter((f) => !RETURNS_KEYS.has(f)).flatMap(offenders);
    expect(found).toEqual([]);
  });
});
