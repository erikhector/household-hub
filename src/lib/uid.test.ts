import { afterEach, describe, expect, test, vi } from "vitest";
import { newUid } from "./uid";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("newUid", () => {
  test("uses crypto.randomUUID when it works", () => {
    expect(newUid()).toMatch(UUID_V4);
  });

  test("falls back to a v4-shaped id when randomUUID throws (plain-HTTP LAN)", () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
    vi.stubGlobal("crypto", {
      randomUUID: () => {
        throw new DOMException("Insecure context", "SecurityError");
      },
      getRandomValues,
    });
    expect(newUid()).toMatch(UUID_V4);
  });

  test("falls back without any crypto at all", () => {
    vi.stubGlobal("crypto", undefined);
    expect(newUid()).toMatch(UUID_V4);
  });
});
