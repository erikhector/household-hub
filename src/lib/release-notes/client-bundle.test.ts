// Guard for PERF-23: releases.json (the whole release history, rewritten on
// every release) must never reach the browser bundle. Walks the static
// import graph from every "use client" module under src/ and fails if any
// path ends at src/lib/release-notes/index.ts or releases.json.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "../..");
const FORBIDDEN = new Set([
  resolve(SRC, "lib/release-notes/index.ts"),
  resolve(SRC, "lib/release-notes/releases.json"),
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = resolve(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

function importsOf(file: string): string[] {
  if (file.endsWith(".json")) return [];
  const text = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const m of text.matchAll(/(?:import|export)\s+(?!type\b)[^;'"]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g)) {
    const r = resolveImport(file, m[1] ?? m[2]);
    if (r) found.push(r);
  }
  return found;
}

describe("client bundle", () => {
  it("no use-client module imports the release history", () => {
    const offenders: string[] = [];
    for (const entry of walk(SRC)) {
      if (!/^\s*["']use client["']/.test(readFileSync(entry, "utf8"))) continue;
      const seen = new Set<string>();
      const stack = [entry];
      while (stack.length) {
        const f = stack.pop()!;
        if (seen.has(f)) continue;
        seen.add(f);
        // A "use server" module is replaced by RPC references in the
        // browser bundle, so what it imports never ships.
        if (f !== entry && /^\s*["']use server["']/.test(readFileSync(f, "utf8"))) continue;
        if (FORBIDDEN.has(f)) {
          offenders.push(entry.replace(SRC, "src"));
          break;
        }
        stack.push(...importsOf(f));
      }
    }
    expect(offenders).toEqual([]);
  });
});
