import { describe, expect, it } from "vitest";
import { resolveBudgetHouseholdView } from "./budget-household-view";

const base = { activeHouseholdId: "home", memberHouseholdIds: ["home", "cabin"] };

describe("resolveBudgetHouseholdView", () => {
  it("shows the active household, writable, when there's no param", () => {
    expect(resolveBudgetHouseholdView({ ...base, param: undefined })).toEqual({
      householdId: "home",
      householdParam: undefined,
      readOnly: false,
    });
  });

  it("shows another member household read-only and keeps the param for navigation", () => {
    expect(resolveBudgetHouseholdView({ ...base, param: "cabin" })).toEqual({
      householdId: "cabin",
      householdParam: "cabin",
      readOnly: true,
    });
  });

  it("stays writable when the param names the active household", () => {
    expect(resolveBudgetHouseholdView({ ...base, param: "home" })).toEqual({
      householdId: "home",
      householdParam: "home",
      readOnly: false,
    });
  });

  it("ignores a household the user isn't a member of (forged id)", () => {
    expect(resolveBudgetHouseholdView({ ...base, param: "someone-elses" })).toEqual({
      householdId: "home",
      householdParam: undefined,
      readOnly: false,
    });
  });

  it("ignores an empty param", () => {
    expect(resolveBudgetHouseholdView({ ...base, param: "" }).householdParam).toBeUndefined();
  });

  it("uses the first value of a repeated param", () => {
    expect(resolveBudgetHouseholdView({ ...base, param: ["cabin", "home"] }).householdId).toBe("cabin");
  });
});
