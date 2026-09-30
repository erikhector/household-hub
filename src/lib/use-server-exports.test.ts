// Every export of a "use server" file becomes a client-callable endpoint, so
// a helper like `resolveShoppingExpenseCategory(tx, householdId)` exported from
// one is a way to hand the server a household id — the one thing AGENTS.md
// says never to accept from the client. This guard keeps such helpers in
// plain server modules: each value export of a "use server" file must be
// named `…Action` (and so is written like a Server Action: session-derived
// tenancy, validated input) or be on the small allowlist below.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");

// Deliberately client-callable without a session, each gated by an
// unguessable token instead of the household id.
const ALLOWED_NON_ACTION_EXPORTS = new Set([
  "getShoppingListByShareToken", // src/app/share/shopping-list/actions.ts
  "getInvitationForDisplay", // src/lib/actions/household.ts
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

function isUseServer(source: string): boolean {
  // The directive must be the first statement (comments may precede it).
  const withoutComments = source.replace(/^(\s|\/\/.*\n|\/\*[\s\S]*?\*\/)*/, "");
  return /^(["'])use server\1/.test(withoutComments);
}

// Value exports only: `export type` / `export interface` are erased at
// compile time and never become endpoints.
function valueExports(source: string): string[] {
  const names: string[] = [];
  for (const m of source.matchAll(
    /^export\s+(?:async\s+)?(?:function\*?|const|let|var|class|enum)\s+(\w+)/gm,
  )) {
    names.push(m[1]);
  }
  for (const m of source.matchAll(/^export\s*\{([^}]*)\}(?!\s*from\s)/gm)) {
    for (const part of m[1].split(",")) {
      const spec = part.trim();
      if (spec && !spec.startsWith("type ")) names.push(spec.split(/\s+as\s+/).pop()!.trim());
    }
  }
  if (/^export\s+default\b/m.test(source)) names.push("default");
  return names;
}

describe('"use server" exports', () => {
  const files = sourceFiles(SRC).filter((f) => isUseServer(readFileSync(f, "utf8")));

  it("finds the actions files", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("exports only *Action functions or allowlisted token-gated readers", () => {
    const offenders = files.flatMap((file) =>
      valueExports(readFileSync(file, "utf8"))
        .filter((name) => !name.endsWith("Action") && !ALLOWED_NON_ACTION_EXPORTS.has(name))
        .map((name) => `${path.relative(SRC, file)}: ${name}`),
    );
    // Fix: move these to a plain server module (they'd be client-callable
    // endpoints), or rename them *Action if they are real Server Actions.
    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist honest: every entry is still exported from a use-server file", () => {
    const exported = new Set(files.flatMap((f) => valueExports(readFileSync(f, "utf8"))));
    for (const name of ALLOWED_NON_ACTION_EXPORTS) expect(exported.has(name)).toBe(true);
  });

  it("detects the export shapes it guards against", () => {
    expect(
      valueExports("export async function fooAction() {}\nexport const bar = 1;\nexport type T = 1;"),
    ).toEqual(["fooAction", "bar"]);
    expect(valueExports("export { a, b as cAction, type D };")).toEqual(["a", "cAction"]);
  });
});
