import { describe, expect, it } from "vitest";
import { tripDurationMinutes } from "./trip-summary";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 22, 10, minute));

describe("tripDurationMinutes", () => {
  it("is the span from the first tick to the last, in whole minutes", () => {
    expect(tripDurationMinutes([at(0), at(7), at(18)])).toBe(18);
  });

  it("ignores rows without a timestamp", () => {
    expect(tripDurationMinutes([null, at(2), null, at(12)])).toBe(10);
  });

  it("is null with fewer than two timestamps", () => {
    expect(tripDurationMinutes([])).toBeNull();
    expect(tripDurationMinutes([at(3), null])).toBeNull();
  });

  it("is null when the ticks are under a minute apart", () => {
    expect(tripDurationMinutes([at(5), new Date(at(5).getTime() + 20_000)])).toBeNull();
  });

  it("is null for a span too long to be one shop", () => {
    expect(tripDurationMinutes([at(0), at(5 * 60)])).toBeNull();
  });

  it("accepts ISO strings", () => {
    expect(tripDurationMinutes([at(0).toISOString(), at(9).toISOString()])).toBe(9);
  });
});
