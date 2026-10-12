import { attachDatabasePool } from "@vercel/functions";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { runWithReadRetry } from "@/lib/db-retry";
import { reportError } from "@/lib/report-error";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgPool: Pool | undefined;
};

// pg's own defaults (max 10, no idle timeout) are sized for a long-running
// server, not a serverless function. The budget page alone fires 14
// queries in parallel, which would exceed a default max of 10 and
// serialize part of that Promise.all on every visit even though nothing
// about those queries actually needs to be serial. Default `max` a bit
// above that, but let it be overridden per-deployment (DATABASE_POOL_MAX)
// since the right number ultimately depends on the pooler sitting in
// front of DATABASE_URL (DEPLOYMENT.md §3) and how many concurrent
// invocations it can absorb — a self-hosted PgBouncer and a small managed
// pooler don't have the same headroom.
const poolMax = Number(process.env.DATABASE_POOL_MAX) || 20;

const pool =
  globalForPrisma.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: poolMax,
    // Serverless invocations are short-lived; a client left idle past the
    // invocation doesn't help the next one (Fluid compute may suspend the
    // instance rather than reuse it) and only holds a slot against the
    // pooler's own connection limit in the meantime. Release idle clients
    // quickly instead of pg's default of never timing them out.
    idleTimeoutMillis: 10_000,
    // Without a bound, a pool that can't get a connection waits forever and
    // the page hangs until the platform kills the invocation. Fail fast
    // instead so the error boundary (or the read retry below) takes over.
    connectionTimeoutMillis: 10_000,
  });

// pg emits "error" on the pool when an *idle* client dies (the pooler closed
// it, the network dropped). With no listener Node treats that as an
// uncaught exception. With one, pg discards the dead client itself, so the
// next checkout opens a fresh connection; all we add is the report.
// Registered only when the pool is new, so dev hot reloads don't stack
// listeners on the cached pool.
if (!globalForPrisma.pgPool) {
  pool.on("error", (error) => {
    reportError("Idle pooled database client errored", error);
  });
}

const adapter = new PrismaPg(pool);

// A connection the pooler closed while it sat idle can still be handed out
// and fails the first query on it. Retry reads once (see db-retry.ts); the
// extension is typed back to PrismaClient because it changes no model API
// and helpers across the codebase accept `PrismaClient`.
export const prisma =
  globalForPrisma.prisma ??
  (new PrismaClient({ adapter }).$extends({
    query: {
      $allOperations({ operation, args, query }) {
        return runWithReadRetry(operation, () => query(args));
      },
    },
  }) as unknown as PrismaClient);

// On Vercel's Fluid compute, an instance can be reused across invocations
// or suspended between them. Without this, a pg client checked back into
// the pool idle can leak past the instance's suspension instead of being
// closed, slowly exhausting the pooler's connection slots. This is a
// no-op everywhere else (plain Node, local dev, CI): it only arms a timer
// via `waitUntil` when VERCEL_URL/VERCEL_REGION are set, which they aren't
// off Vercel (see node_modules/@vercel/functions/db-connections).
attachDatabasePool(pool);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.pgPool = pool;
}
