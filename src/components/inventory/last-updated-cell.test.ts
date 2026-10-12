import { describe, it, expect } from "vitest";
import { en } from "@/lib/i18n/dictionaries/en";
import { format } from "@/lib/i18n/format";

describe("LastUpdated label formatting", () => {
  it("formats the no-user last-updated label", () => {
    const dateLabel = "4 Oct";
    const formatted = format(en.inventory.lastUpdatedNoUser, { date: dateLabel });
    expect(formatted).toBe("Last updated 4 Oct");
  });
});
