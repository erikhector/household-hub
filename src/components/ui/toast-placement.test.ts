// UX-48: toasts must never sit in the bottom band that sheet footers, the
// shopping dock and the BottomNav own on a phone.
import { describe, expect, it } from "vitest";
import { PHONE_QUERY, TOAST_TOP, toastPlacement } from "./toast-placement";

describe("toastPlacement", () => {
  it("puts phone toasts at the top, below the safe-area inset", () => {
    const placement = toastPlacement(true);
    expect(placement.position).toBe("top-center");
    expect(placement.offset).toEqual({ top: TOAST_TOP });
    expect(TOAST_TOP).toContain("env(safe-area-inset-top)");
  });

  it("keeps Sonner's bottom-right corner everywhere else", () => {
    expect(toastPlacement(false)).toEqual({ position: "bottom-right", offset: undefined });
  });

  it("treats the BottomNav range (below 640 px) as the phone range", () => {
    expect(PHONE_QUERY).toBe("(max-width: 639px)");
  });
});
