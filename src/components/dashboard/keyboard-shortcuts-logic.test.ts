import { describe, expect, it } from "vitest";
import { isShortcutPath, isTypingTarget, moveIndex, shortcutFor } from "./keyboard-shortcuts-logic";

const key = (k: string, mods: Partial<Record<"metaKey" | "ctrlKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("shortcutFor", () => {
  it("maps the plain keys", () => {
    expect(shortcutFor(key("n"))).toBe("new");
    expect(shortcutFor(key("/"))).toBe("search");
    expect(shortcutFor(key("j"))).toBe("next");
    expect(shortcutFor(key("k"))).toBe("previous");
    expect(shortcutFor(key("x"))).toBe("tick");
    expect(shortcutFor(key("?", { shiftKey: true }))).toBe("help");
  });

  it("keeps / working where it needs Shift (Swedish keyboards)", () => {
    expect(shortcutFor(key("/", { shiftKey: true }))).toBe("search");
  });

  it("leaves modified keys to the browser and the command palette", () => {
    expect(shortcutFor(key("k", { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key("k", { metaKey: true }))).toBeNull();
    expect(shortcutFor(key("n", { altKey: true }))).toBeNull();
    expect(shortcutFor(key("N", { shiftKey: true }))).toBeNull();
  });

  it("ignores other keys", () => {
    expect(shortcutFor(key("a"))).toBeNull();
    expect(shortcutFor(key("Enter"))).toBeNull();
  });
});

describe("isShortcutPath", () => {
  it("matches the three list pages and their children only", () => {
    expect(isShortcutPath("/dashboard/tasks")).toBe(true);
    expect(isShortcutPath("/dashboard/inventory")).toBe(true);
    expect(isShortcutPath("/dashboard/shopping-list/abc")).toBe(true);
    expect(isShortcutPath("/dashboard/inventory-x")).toBe(false);
    expect(isShortcutPath("/dashboard/budget")).toBe(false);
  });
});

describe("isTypingTarget", () => {
  const el = (tagName: string, extra: Record<string, unknown> = {}) =>
    ({ tagName, getAttribute: () => null, ...extra }) as unknown as EventTarget;

  it("is true for text fields and editable widgets", () => {
    expect(isTypingTarget(el("INPUT", { type: "search" }))).toBe(true);
    expect(isTypingTarget(el("TEXTAREA"))).toBe(true);
    expect(isTypingTarget(el("SELECT"))).toBe(true);
    expect(isTypingTarget(el("DIV", { isContentEditable: true }))).toBe(true);
    expect(isTypingTarget(el("DIV", { getAttribute: () => "combobox" }))).toBe(true);
  });

  it("is false for checkboxes, buttons and the page", () => {
    expect(isTypingTarget(el("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isTypingTarget(el("BUTTON"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe("moveIndex", () => {
  it("starts at the first row and clamps at both ends", () => {
    expect(moveIndex(-1, 3, "next")).toBe(0);
    expect(moveIndex(-1, 3, "previous")).toBe(0);
    expect(moveIndex(0, 3, "next")).toBe(1);
    expect(moveIndex(2, 3, "next")).toBe(2);
    expect(moveIndex(0, 3, "previous")).toBe(0);
    expect(moveIndex(2, 3, "previous")).toBe(1);
  });

  it("returns -1 for no rows and recovers from a stale index", () => {
    expect(moveIndex(0, 0, "next")).toBe(-1);
    expect(moveIndex(5, 3, "next")).toBe(0);
  });
});
