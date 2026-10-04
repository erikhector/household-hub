import { describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { isUniqueViolation } from "@/lib/prisma-errors";

function knownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("boom", { code, clientVersion: "test" });
}

describe("isUniqueViolation", () => {
  it("is true for P2002 only", () => {
    expect(isUniqueViolation(knownError("P2002"))).toBe(true);
    expect(isUniqueViolation(knownError("P2025"))).toBe(false);
  });

  it("is false for anything that isn't a Prisma known-request error", () => {
    expect(isUniqueViolation(new Error("P2002"))).toBe(false);
    expect(isUniqueViolation({ code: "P2002" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
