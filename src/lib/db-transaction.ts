// BUG-5: Prisma's interactive-transaction defaults are `maxWait` 2 s (time to
// get a connection) and `timeout` 5 s (time the whole callback may run). In
// production the first write of a tiny tick transaction sometimes missed the
// 5 s ("A query cannot be executed on an expired transaction … 5121 ms
// passed"), which points at slow connection hand-out (cold function, pooler
// saturation) rather than the work itself. Give every interactive
// `prisma.$transaction(async …)` the same, more forgiving budget from one
// place. The pool's own `connectionTimeoutMillis` (src/lib/prisma.ts) stays
// the hard bound on waiting for a connection, so this can't hang forever.
export const INTERACTIVE_TX_OPTIONS = { maxWait: 10_000, timeout: 15_000 } as const;
