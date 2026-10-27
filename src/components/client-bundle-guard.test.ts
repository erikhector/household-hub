// Guard for PERF-7 / PERF-24: `zod` must not reach a client bundle. Twice a
// client component imported a constant from a module that also defined a zod
// schema, which put ~30 KB gz of zod into the meal-planning page. Walks the
// value imports of every "use client" file under src/components/ and fails
// with the import chain when one leads to `zod`.

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");
const COMPONENTS = path.join(SRC, "components");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const read = (file: string) => readFileSync(file, "utf8");
const hasDirective = (source: string, directive: string) =>
  new RegExp(`^\\s*(?:(?://[^\\n]*(?=\\n)|/\\*[\\s\\S]*?\\*/)\\s*)*["']${directive}["']`).test(source);

// Specifiers of the imports that survive compilation: `import type` and
// `export type` vanish, as does `import { type A, type B }`.
function valueImports(source: string): string[] {
  const specs: string[] = [];
  const re =
    /(?:^|\n)\s*(import|export)\s+(type\s+)?(?:([\w*\s{},$]*?)\s+from\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of source.matchAll(re)) {
    if (m[5]) {
      specs.push(m[5]);
      continue;
    }
    if (m[2]) continue;
    const names = m[3];
    if (names?.includes("{") && !names.replace(/\{[^}]*\}/, "").trim().replace(/,/g, "")) {
      const inner = names.slice(names.indexOf("{") + 1, names.lastIndexOf("}"));
      const all = inner.split(",").map((s) => s.trim()).filter(Boolean);
      if (all.length > 0 && all.every((s) => s.startsWith("type "))) continue;
    }
    specs.push(m[4]);
  }
  return specs;
}

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

// Depth-first search for a chain from `entry` to a `zod` import, or null.
function zodChain(entry: string, seen = new Set<string>()): string[] | null {
  if (seen.has(entry)) return null;
  seen.add(entry);
  const source = read(entry);
  // A "use server" module is swapped for reference stubs in the client
  // bundle, so what it imports never ships.
  if (hasDirective(source, "use server")) return null;
  for (const spec of valueImports(source)) {
    if (spec === "zod" || spec.startsWith("zod/")) return [path.relative(SRC, entry), "zod"];
    const next = resolve(entry, spec);
    if (!next) continue;
    const chain = zodChain(next, seen);
    if (chain) return [path.relative(SRC, entry), ...chain];
  }
  return null;
}

describe("client bundle guard", () => {
  it("detects value imports and ignores type-only ones", () => {
    const source = [
      'import { a } from "./a";',
      'import type { B } from "./b";',
      'import { type C, type D } from "./c";',
      'import { e, type F } from "./e";',
      'export { g } from "./g";',
      'export type { H } from "./h";',
      'const x = import("./lazy");',
    ].join("\n");
    expect(valueImports(source)).toEqual(["./a", "./e", "./g", "./lazy"]);
  });

  it("finds the client components to check", () => {
    const clientFiles = walk(COMPONENTS).filter((f) => hasDirective(read(f), "use client"));
    expect(clientFiles.length).toBeGreaterThan(10);
  });

  it("keeps zod out of every client component's imports", () => {
    const offenders = walk(COMPONENTS)
      .filter((file) => hasDirective(read(file), "use client"))
      .flatMap((file) => {
        const chain = zodChain(file);
        return chain ? [chain.join(" -> ")] : [];
      });
    expect(offenders).toEqual([]);
  });
});
