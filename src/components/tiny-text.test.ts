// DESIGN.md M9: 12 px is the floor for chrome, nothing smaller anywhere. The
// notification badge (10 px) and the quick-add labels (11 px) slipped under
// it as arbitrary text-[Npx] values, which no lint rule catches, so this
// scans every component for one below the floor.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return entry.endsWith(".tsx") ? [full] : [];
  });
}

describe("minimum text size", () => {
  it("no component sets an arbitrary text size under 12px", () => {
    const offenders = tsxFiles(SRC).filter((file) => /text-\[(?:[0-9]|1[01])px\]/.test(readFileSync(file, "utf8")));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
