import { describe, expect, it, vi } from "vitest";
import { resolveSheetInitialFocus } from "./sheet-focus";

// Stand-ins: the resolver only passes elements through, never touches them.
const popup = { id: "popup" } as unknown as HTMLElement;
const field = { id: "field" } as unknown as HTMLElement;

describe("resolveSheetInitialFocus (UX-34)", () => {
  it("focuses the sheet itself on a touch open, so the keyboard stays down", () => {
    const initialFocus = vi.fn(() => field);
    expect(resolveSheetInitialFocus({ interactionType: "touch", coarsePointer: true, popup, initialFocus })).toBe(popup);
    // The caller's choice is for non-touch opens only.
    expect(initialFocus).not.toHaveBeenCalled();
  });

  it("treats an open with no pointer of its own as touch on a coarse-pointer device", () => {
    expect(resolveSheetInitialFocus({ interactionType: "", coarsePointer: true, popup, initialFocus: undefined })).toBe(popup);
  });

  it("keeps the default (first field) for an unknown open on a desktop", () => {
    expect(resolveSheetInitialFocus({ interactionType: "", coarsePointer: false, popup, initialFocus: undefined })).toBe(true);
  });

  it("trusts a keyboard open even on a phone", () => {
    expect(resolveSheetInitialFocus({ interactionType: "keyboard", coarsePointer: true, popup, initialFocus: undefined })).toBe(true);
  });

  it("applies the caller's initialFocus to mouse and keyboard opens", () => {
    expect(resolveSheetInitialFocus({ interactionType: "mouse", coarsePointer: false, popup, initialFocus: { current: field } })).toBe(field);
    expect(resolveSheetInitialFocus({ interactionType: "keyboard", coarsePointer: false, popup, initialFocus: false })).toBe(false);
    const initialFocus = vi.fn(() => field);
    expect(resolveSheetInitialFocus({ interactionType: "mouse", coarsePointer: false, popup, initialFocus })).toBe(field);
    expect(initialFocus).toHaveBeenCalledWith("mouse");
  });

  it("applies initialFocus on a touch open only when the sheet opts in (UX-109)", () => {
    const initialFocus = { current: field };
    expect(resolveSheetInitialFocus({ interactionType: "touch", coarsePointer: true, popup, initialFocus, focusOnTouch: true })).toBe(field);
    expect(resolveSheetInitialFocus({ interactionType: "touch", coarsePointer: true, popup, initialFocus: undefined, focusOnTouch: true })).toBe(popup);
  });
});
