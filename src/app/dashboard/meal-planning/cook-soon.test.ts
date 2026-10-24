import { describe, expect, it, vi } from "vitest";
import { clearCookSoon, splitCookSoon } from "./cook-soon";

describe("clearCookSoon", () => {
  it("clears only a queued recipe of this household", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    await clearCookSoon({ recipe: { updateMany } }, "h1", "r1");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "r1", householdId: "h1", cookSoonAt: { not: null } },
      data: { cookSoonAt: null },
    });
  });

  it("writes nothing for a freeform meal", async () => {
    const updateMany = vi.fn();
    await clearCookSoon({ recipe: { updateMany } }, "h1", null);
    await clearCookSoon({ recipe: { updateMany } }, "h1", undefined);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe("splitCookSoon", () => {
  const r = (id: string, cookSoonAt: string | null) => ({ id, cookSoonAt });

  it("pins queued recipes oldest first and keeps the rest in order", () => {
    const { shelf, rest } = splitCookSoon([
      r("a", null),
      r("b", "2026-10-03T10:00:00.000Z"),
      r("c", null),
      r("d", "2026-10-01T10:00:00.000Z"),
    ]);
    expect(shelf.map((x) => x.id)).toEqual(["d", "b"]);
    expect(rest.map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("returns an empty shelf when nothing is queued", () => {
    const { shelf, rest } = splitCookSoon([r("a", null)]);
    expect(shelf).toEqual([]);
    expect(rest).toHaveLength(1);
  });
});
