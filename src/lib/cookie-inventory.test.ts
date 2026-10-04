// Guards against the privacy policy's cookie list drifting from the code:
// every `*_COOKIE = "name"`, `*_COOKIE_PREFIX = "prefix"` (a cookie keyed per
// id, e.g. per household) and `*_STORAGE_KEY = "name"` (localStorage)
// constant under src/ must have an entry in STORAGE_INVENTORY
// (src/lib/cookie-inventory.ts).
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  NUTRITION_RECAP_DISMISSED_STORAGE_KEY,
  STORAGE_INVENTORY,
  TASKS_RECAP_DISMISSED_STORAGE_KEY,
  USE_IT_UP_DISMISSED_STORAGE_KEY,
  VARIETY_RECAP_DISMISSED_STORAGE_KEY,
} from "@/lib/cookie-inventory";

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
    for (const match of text.matchAll(
      /\b[A-Z_]+_(?:COOKIE|COOKIE_PREFIX|STORAGE_KEY)\s*=\s*"([^"]+)"/g,
    )) {
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

describe("dismissal keys", () => {
  // useDismissedLocalStorage only accepts these (typed via DismissedStorageKey),
  // so each must be a listed localStorage preference.
  it("are each listed as a localStorage preference", () => {
    for (const name of [
      USE_IT_UP_DISMISSED_STORAGE_KEY,
      NUTRITION_RECAP_DISMISSED_STORAGE_KEY,
      VARIETY_RECAP_DISMISSED_STORAGE_KEY,
      TASKS_RECAP_DISMISSED_STORAGE_KEY,
    ]) {
      const entry = STORAGE_INVENTORY.find((e) => e.name === name);
      expect(entry, `${name} missing from STORAGE_INVENTORY`).toMatchObject({
        kind: "localStorage",
        category: "preference",
      });
    }
  });

  it("are only persisted through the shared hook, not hand-rolled in components", () => {
    const offenders = sourceFiles(path.join(SRC, "components"))
      .filter((file) => /localStorage\.(get|set)Item\(\s*[A-Z_]*DISMISSED/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
