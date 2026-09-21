// Guards against the privacy policy's cookie list drifting from the code:
// every `*_COOKIE = "name"` constant under src/ must have an entry in
// STORAGE_INVENTORY (src/lib/cookie-inventory.ts).
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { STORAGE_INVENTORY } from "@/lib/cookie-inventory";

const SRC = path.resolve(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return entry === "generated" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry) ? [full] : [];
  });
}

function declaredCookieNames(): string[] {
  const names = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\b[A-Z_]+_COOKIE\s*=\s*"([^"]+)"/g)) {
      names.add(match[1]);
    }
  }
  return [...names];
}

describe("STORAGE_INVENTORY", () => {
  it("lists every cookie constant declared in src/", () => {
    const listed = new Set(STORAGE_INVENTORY.map((entry) => entry.name));
    const declared = declaredCookieNames();
    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) {
      expect(listed, `cookie "${name}" is missing from STORAGE_INVENTORY`).toContain(name);
    }
  });

  it("has no duplicate names", () => {
    const names = STORAGE_INVENTORY.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
