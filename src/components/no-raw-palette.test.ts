// Guard for UX-162: status colour comes from the `warning` / `attention`
// tokens (globals.css), which carry a light and a dark value that clear
// contrast. A raw `amber-500` / `amber-600` utility doesn't (amber-600 on its
// 10% tint over the card was 2.91:1 in light) and skips the dark-mode pair.
// Fails with the file and line of any `amber-<shade>` class in a component.

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const COMPONENTS = __dirname;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("colour tokens", () => {
  it("uses no raw amber-<shade> utility in src/components", () => {
    const hits = walk(COMPONENTS).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) =>
          /\bamber-\d{2,3}\b/.test(line) ? [`${path.relative(COMPONENTS, file)}:${i + 1}: ${line.trim()}`] : [],
        ),
    );
    expect(hits, "use bg-warning/10 text-warning (or text-attention) instead").toEqual([]);
  });
});
