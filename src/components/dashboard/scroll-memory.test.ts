// UX-193: the history.state helpers behind the scroll memory. The flow
// itself (scroll, leave, Back) needs a browser and is covered in
// e2e/ux-193.spec.ts; the offset outliving the router's state replaces is
// in dialog-history.test.ts.
import { describe, expect, it } from "vitest";
import { savedOffset, withOffset } from "./scroll-memory";

const routerState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: ["", {}] };

describe("savedOffset", () => {
  it("reads back what withOffset wrote", () => {
    expect(savedOffset(withOffset(routerState, 420))).toBe(420);
    expect(savedOffset(withOffset(routerState, 0))).toBe(0);
  });

  it("is null for an entry that never remembered one", () => {
    expect(savedOffset(null)).toBeNull();
    expect(savedOffset(undefined)).toBeNull();
    expect(savedOffset("state")).toBeNull();
    expect(savedOffset(routerState)).toBeNull();
  });

  it("ignores a value that isn't a usable offset", () => {
    for (const bad of ["420", -1, Number.NaN, Number.POSITIVE_INFINITY, null]) {
      expect(savedOffset({ ...withOffset(routerState, 1), __squirrelScroll: bad })).toBeNull();
    }
  });
});

describe("withOffset", () => {
  it("keeps the router's own keys, so its replaceState patch passes the entry through", () => {
    expect(withOffset(routerState, 420)).toMatchObject(routerState);
  });

  it("starts from nothing when the entry has no state yet", () => {
    expect(savedOffset(withOffset(null, 7))).toBe(7);
  });

  it("replaces an older offset", () => {
    expect(savedOffset(withOffset(withOffset(routerState, 420), 12))).toBe(12);
  });
});
