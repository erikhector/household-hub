// Retry-once for reads that hit a dead pooled connection (BUG-1).
//
// A pooler (or the network) can close a connection while it sits idle in our
// pg Pool. pg only finds out when the next query is written to it, so the
// first query on that client fails with "Connection terminated unexpectedly"
// even though a fresh connection would work. By the time it fails pg has
// already discarded the client, so simply running the query again checks out
// a healthy (or brand new) one.
//
// Only reads are retried. A write that dies mid-flight may or may not have
// been applied, and re-running it could double-insert or double-apply, so
// writes surface the error as before.

const READ_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  // The only raw queries in the app are SELECTs (health check, budget page).
  // `$executeRaw*` is deliberately absent: it is always a write.
  "$queryRaw",
  "$queryRawUnsafe",
]);

export function isReadOperation(operation: string): boolean {
  return READ_OPERATIONS.has(operation);
}

/**
 * True for the pg error raised when the server (or pooler) closed the socket
 * under an in-flight query. Matches on the message because pg throws a plain
 * `Error`; Prisma may wrap it, so the cause chain is followed too.
 */
export function isDroppedConnectionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    if (current.message.includes("Connection terminated unexpectedly"))
      return true;
    current = current.cause;
  }
  return false;
}

/** Runs `run`; for a read, retries once if the connection was dropped. */
export async function runWithReadRetry<T>(
  operation: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isReadOperation(operation) && isDroppedConnectionError(error)) {
      return run();
    }
    throw error;
  }
}
