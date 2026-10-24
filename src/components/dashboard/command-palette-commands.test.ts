import { describe, expect, it } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { buildCommands, filterCommands, isPaletteShortcut } from "./command-palette-commands";

const commands = buildCommands(en.commandPalette, en.nav);

describe("buildCommands", () => {
  it("lists quick actions first, then one go-to per nav section", () => {
    expect(commands[0].label).toBe("Add task");
    expect(commands[1].href).toBe("/dashboard/shopping-list?add=1");
    expect(commands.map((c) => c.label)).toContain("Go to Household budget");
    expect(commands.filter((c) => c.kind === "goTo")).toHaveLength(9);
  });

  it("is translated", () => {
    expect(buildCommands(sv.commandPalette, sv.nav).map((c) => c.label)).toContain("Gå till Inköpslista");
  });
});

describe("filterCommands", () => {
  it("returns everything for a blank query", () => {
    expect(filterCommands(commands, "  ")).toEqual(commands);
  });

  it("matches case-insensitively, in any word order", () => {
    expect(filterCommands(commands, "BUDGET go").map((c) => c.id)).toEqual(["go-budget", "go-personalBudget"]);
  });

  it("returns nothing when no label matches", () => {
    expect(filterCommands(commands, "zzz")).toEqual([]);
  });
});

describe("isPaletteShortcut", () => {
  const base = { key: "k", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };
  it("accepts Ctrl+K and Cmd+K", () => {
    expect(isPaletteShortcut({ ...base, ctrlKey: true })).toBe(true);
    expect(isPaletteShortcut({ ...base, metaKey: true, key: "K" })).toBe(true);
  });
  it("ignores a bare K and modified variants", () => {
    expect(isPaletteShortcut(base)).toBe(false);
    expect(isPaletteShortcut({ ...base, ctrlKey: true, shiftKey: true })).toBe(false);
  });
});
