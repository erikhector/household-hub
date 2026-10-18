import { describe, expect, it } from "vitest";
import {
  cookScale,
  currentStepIndex,
  formatCookQuantity,
  formatCountdown,
  formatTimerLabel,
  hasCookProgress,
  parseStepDuration,
  splitSteps,
} from "@/lib/cook-mode-calc";

describe("splitSteps", () => {
  it("splits on lines, trims and drops blanks", () => {
    expect(splitSteps("Mix\r\n\n  Bake  \n")).toEqual(["Mix", "Bake"]);
  });
  it("returns no steps for empty or missing instructions", () => {
    expect(splitSteps(null)).toEqual([]);
    expect(splitSteps("  \n ")).toEqual([]);
  });
});

describe("cookScale", () => {
  it("scales to the entry's portions", () => {
    expect(cookScale(4, 2)).toBe(0.5);
    expect(cookScale(4, 6)).toBe(1.5);
  });
  it("leaves amounts as written without a meal entry", () => {
    expect(cookScale(4, null)).toBe(1);
  });
  it("never produces NaN or Infinity", () => {
    expect(cookScale(0, 2)).toBe(1);
    expect(cookScale(4, 0)).toBe(1);
  });
});

describe("formatCookQuantity", () => {
  it("rounds to two decimals without trailing zeros", () => {
    expect(formatCookQuantity(750, 0.5, "en")).toBe("375");
    expect(formatCookQuantity(1, 1 / 3, "en")).toBe("0.33");
  });
  it("uses the locale's decimal mark", () => {
    expect(formatCookQuantity(1, 0.5, "sv")).toBe("0,5");
  });
});

describe("parseStepDuration", () => {
  it("reads minutes in English and Swedish", () => {
    expect(parseStepDuration("Simmer for 15 minutes")).toBe(900);
    expect(parseStepDuration("Simmer 15 min.")).toBe(900);
    expect(parseStepDuration("Koka i 10 min")).toBe(600);
    expect(parseStepDuration("Låt koka i 20 minuter")).toBe(1200);
    expect(parseStepDuration("Stek 1 minut per sida")).toBe(60);
  });
  it("reads hours, seconds and decimals", () => {
    expect(parseStepDuration("Roast for 2 hours")).toBe(7200);
    expect(parseStepDuration("Ugnen i 1,5 timmar")).toBe(5400);
    expect(parseStepDuration("Bake 1.5 h")).toBe(5400);
    expect(parseStepDuration("Rest ½ hour")).toBe(1800);
    expect(parseStepDuration("Sear 30 seconds")).toBe(30);
    expect(parseStepDuration("Vispa 45 sek")).toBe(45);
  });
  it("uses the upper bound of a range", () => {
    expect(parseStepDuration("Bake 10-12 min")).toBe(720);
    expect(parseStepDuration("Bake 10–12 minutes")).toBe(720);
    expect(parseStepDuration("Bake 10 to 12 minutes")).toBe(720);
    expect(parseStepDuration("Grädda 10 till 12 min")).toBe(720);
    expect(parseStepDuration("Bake 1-2 hours")).toBe(7200);
  });
  it("adds back-to-back phrases", () => {
    expect(parseStepDuration("Braise 1 hour 30 minutes")).toBe(5400);
    expect(parseStepDuration("Stek 1 timme och 15 min")).toBe(4500);
  });
  it("takes the first of several separate durations", () => {
    expect(parseStepDuration("Sear 2 min a side, then bake 20 min")).toBe(120);
  });
  it("returns null when there is no usable duration", () => {
    expect(parseStepDuration("Whisk the batter")).toBeNull();
    expect(parseStepDuration("Add 3 dl flour")).toBeNull();
    expect(parseStepDuration("Heat to 180 degrees")).toBeNull();
    expect(parseStepDuration("Use a 2 mm mincer")).toBeNull();
    expect(parseStepDuration("Rest for 0 min")).toBeNull();
    expect(parseStepDuration("Marinate for 48 hours")).toBeNull();
  });
});

describe("formatTimerLabel / formatCountdown", () => {
  it("labels the button", () => {
    expect(formatTimerLabel(900)).toBe("15 min");
    expect(formatTimerLabel(5400)).toBe("1 h 30 min");
    expect(formatTimerLabel(45)).toBe("45 s");
  });
  it("formats the countdown", () => {
    expect(formatCountdown(872)).toBe("14:32");
    expect(formatCountdown(5)).toBe("0:05");
    expect(formatCountdown(3900)).toBe("1:05:00");
    expect(formatCountdown(-3)).toBe("0:00");
    expect(formatCountdown(0.2)).toBe("0:01");
  });
});

describe("currentStepIndex", () => {
  it("is the first step not ticked off", () => {
    expect(currentStepIndex(3, new Set())).toBe(0);
    expect(currentStepIndex(3, new Set([0]))).toBe(1);
    expect(currentStepIndex(3, new Set([0, 2]))).toBe(1);
  });
  it("is null when every step is done or there are none", () => {
    expect(currentStepIndex(2, new Set([0, 1]))).toBeNull();
    expect(currentStepIndex(0, new Set())).toBeNull();
  });
  // The dialog shows "Done" exactly when this is null, so a recipe with no
  // steps still offers it from a planned meal instead of a dead end.
  it("is null for no steps whatever is in the done set", () => {
    expect(currentStepIndex(0, new Set([0, 1]))).toBeNull();
  });
});

describe("hasCookProgress", () => {
  it("is true for a ticked step or a running timer", () => {
    expect(hasCookProgress(1, 0)).toBe(true);
    expect(hasCookProgress(0, 2)).toBe(true);
  });
  it("is false for a fresh view", () => {
    expect(hasCookProgress(0, 0)).toBe(false);
  });
});
