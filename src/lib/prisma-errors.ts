import { Prisma } from "@/generated/prisma/client";

/**
 * True for Prisma's unique-constraint violation (P2002), i.e. a concurrent
 * insert or a duplicate name beat the caller's own pre-check. Callers decide
 * what that means (friendly message, or "someone else already did it").
 */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
