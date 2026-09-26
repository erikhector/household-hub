// Tests the pool configuration in src/lib/prisma.ts: the explicit `max`
// (with its DATABASE_POOL_MAX override) and `idleTimeoutMillis`, and that
// the pool actually gets handed to `attachDatabasePool` (PERF-10). None of
// this touches a real database — `pg`, `@prisma/adapter-pg`,
// `@vercel/functions` and the generated Prisma client are all mocked, and
// the module is re-imported fresh per test (vi.resetModules) since it
// reads process.env.DATABASE_POOL_MAX at import time.
import { afterEach, describe, expect, it, vi } from "vitest";

const { poolCtorMock, prismaPgMock, attachDatabasePoolMock } = vi.hoisted(() => ({
  poolCtorMock: vi.fn(),
  prismaPgMock: vi.fn(),
  attachDatabasePoolMock: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: class {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      poolCtorMock(options);
    }
  },
}));

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(pool: unknown) {
      prismaPgMock(pool);
    }
  },
}));

vi.mock("@vercel/functions", () => ({
  attachDatabasePool: attachDatabasePoolMock,
}));

vi.mock("@/generated/prisma/client", () => ({
  // The real PrismaClient does real work in its constructor; the pool
  // config under test doesn't depend on it, so a bare stand-in is enough.
  PrismaClient: class {},
}));

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  // The module caches its Prisma client and pg Pool on `globalThis` (dev
  // hot-reload guard) — vi.resetModules() alone doesn't clear that, so a
  // later test would see the previous test's pool as already constructed.
  delete (globalThis as Record<string, unknown>).prisma;
  delete (globalThis as Record<string, unknown>).pgPool;
  vi.resetModules();
  vi.clearAllMocks();
});

describe("prisma pool config", () => {
  it("defaults to max 20 and a 10s idle timeout", async () => {
    delete process.env.DATABASE_POOL_MAX;
    await import("@/lib/prisma");

    expect(poolCtorMock).toHaveBeenCalledTimes(1);
    const options = poolCtorMock.mock.calls[0][0];
    expect(options.max).toBe(20);
    expect(options.idleTimeoutMillis).toBe(10_000);
  });

  it("honors DATABASE_POOL_MAX when set", async () => {
    process.env.DATABASE_POOL_MAX = "5";
    await import("@/lib/prisma");

    const options = poolCtorMock.mock.calls[0][0];
    expect(options.max).toBe(5);
  });

  it("falls back to the default for a non-numeric DATABASE_POOL_MAX", async () => {
    process.env.DATABASE_POOL_MAX = "not-a-number";
    await import("@/lib/prisma");

    const options = poolCtorMock.mock.calls[0][0];
    expect(options.max).toBe(20);
  });

  it("passes the pg Pool (not a config object) to PrismaPg", async () => {
    await import("@/lib/prisma");

    expect(prismaPgMock).toHaveBeenCalledTimes(1);
    const poolArg = prismaPgMock.mock.calls[0][0];
    expect(poolArg).toBeInstanceOf((await import("pg")).Pool);
  });

  it("registers the pool with attachDatabasePool", async () => {
    await import("@/lib/prisma");

    expect(attachDatabasePoolMock).toHaveBeenCalledTimes(1);
    const poolArg = attachDatabasePoolMock.mock.calls[0][0];
    expect(poolArg).toBeInstanceOf((await import("pg")).Pool);
  });
});
