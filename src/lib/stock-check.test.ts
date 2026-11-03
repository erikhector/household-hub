import { describe, expect, it, vi } from "vitest";
import { buildStockCheckQueue, confirmStockCheckStep, inputModeForUnit, readCountedAmount } from "./stock-check";

describe("confirmStockCheckStep", () => {
  const flour = { id: "flour-1", quantity: 2 };

  it("sends a changed amount as a counted value", async () => {
    const save = vi.fn().mockResolvedValue({ updated: 1 });
    const step = await confirmStockCheckStep(flour, "0.5", save);
    expect(save).toHaveBeenCalledWith([{ itemId: "flour-1", quantity: 0.5 }]);
    expect(step).toEqual({ kind: "corrected", quantity: 0.5, result: { updated: 1 } });
  });

  it("does not send an unchanged, blank or invalid amount", async () => {
    const save = vi.fn();
    expect((await confirmStockCheckStep(flour, "2", save)).kind).toBe("kept");
    expect((await confirmStockCheckStep(flour, "", save)).kind).toBe("kept");
    expect((await confirmStockCheckStep(flour, "x", save)).kind).toBe("invalid");
    expect(save).not.toHaveBeenCalled();
  });
});

const item = (id: string, name: string, location: string | null, quantity = 1, unit = "pcs") => ({
  id,
  name,
  quantity,
  unit,
  location,
});

describe("buildStockCheckQueue", () => {
  const items = [item("1", "Rice", "Pantry"), item("2", "Butter", "Fridge"), item("3", "Apples", "Pantry", 0), item("4", "Salt", null)];

  it("walks one location sorted by name, zero amounts included", () => {
    expect(buildStockCheckQueue(items, "Pantry").map((i) => i.name)).toEqual(["Apples", "Rice"]);
  });

  it("walks everything for All, including items with no location", () => {
    expect(buildStockCheckQueue(items, null).map((i) => i.name)).toEqual(["Apples", "Butter", "Rice", "Salt"]);
  });
});

describe("readCountedAmount", () => {
  it("keeps a blank field or the same amount (nothing to save)", () => {
    expect(readCountedAmount(2, "")).toEqual({ kind: "kept" });
    expect(readCountedAmount(2, " 2 ")).toEqual({ kind: "kept" });
  });

  it("reports a different amount as changed, accepting a decimal comma and 0", () => {
    expect(readCountedAmount(2, "0.5")).toEqual({ kind: "changed", quantity: 0.5 });
    expect(readCountedAmount(2, "1,5")).toEqual({ kind: "changed", quantity: 1.5 });
    expect(readCountedAmount(2, "0")).toEqual({ kind: "changed", quantity: 0 });
  });

  it("rejects text and negatives", () => {
    expect(readCountedAmount(2, "abc")).toEqual({ kind: "invalid" });
    expect(readCountedAmount(2, "-1")).toEqual({ kind: "invalid" });
  });
});

describe("inputModeForUnit", () => {
  it("uses the digit pad for whole pieces and the decimal pad otherwise", () => {
    expect(inputModeForUnit("pcs", 3)).toBe("numeric");
    expect(inputModeForUnit("pcs", 1.5)).toBe("decimal");
    expect(inputModeForUnit("kg", 2)).toBe("decimal");
  });
});
