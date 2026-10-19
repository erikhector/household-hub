import { Prisma } from "@/generated/prisma/client";

/**
 * True for Prisma's unique-constraint violation (P2002), i.e. a concurrent
 * insert or a duplicate name beat the caller's own pre-check. Callers decide
 * what that means (friendly message, or "someone else already did it").
 */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Whether a P2002 came from the unique index on plannedExpenseId. With the pg
 * driver adapter (Prisma 7) there is no `meta.target`: the violated
 * constraint sits at `meta.driverAdapterError.cause.constraint`, as `fields`
 * or, since Postgres always names its constraint, as `index`
 * ("Transaction_plannedExpenseId_key", or
 * "PersonalTransaction_plannedExpenseId_key" on the personal budget).
 * `meta.target` is kept as a fallback.
 */
export function isPlannedExpenseTarget(error: unknown): boolean {
  const meta = (error as {
    meta?: {
      target?: unknown;
      driverAdapterError?: { cause?: { constraint?: { fields?: unknown; index?: unknown } } };
    };
  }).meta;
  const constraint = meta?.driverAdapterError?.cause?.constraint;
  const candidates: unknown[] = [
    ...(Array.isArray(constraint?.fields) ? constraint.fields : []),
    constraint?.index,
    ...(Array.isArray(meta?.target) ? meta.target : [meta?.target]),
  ];
  return candidates.some((c) => typeof c === "string" && c.includes("plannedExpenseId"));
}
