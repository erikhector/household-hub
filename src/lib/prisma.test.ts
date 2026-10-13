// Tests the pool configuration in src/lib/prisma.ts: the explicit `max`
// (with its DATABASE_POOL_MAX override) and `idleTimeoutMillis`, and that
// the pool actually gets handed to `attachDatabasePool` (PERF-10). None of
// this touches a real database — `pg`, `@prisma/adapter-pg`,
// `@vercel/functions` and the generated Prisma client are all mocked, and
// the module is re-imported fresh per test (vi.resetModules) since it
// reads process.env.DATABASE_POOL_MAX at import time.
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  poolCtorMock,
  poolOnMock,
  reportErrorMock,
  prismaPgMock,
  attachDatabasePoolMock,
} = vi.hoisted(() => ({
  poolCtorMock: vi.fn(),
  poolOnMock: vi.fn(),
  reportErrorMock: vi.fn(),
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
    on(event: string, handler: (error: Error) => void) {
      poolOnMock(event, handler);
      return this;
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
  PrismaClient: class {
    // Stand-in for the retry extension: hands back the config so a test can
    // call the $allOperations hook directly.
    $extends(extension: unknown) {
      return { extension };
    }
  },
}));

vi.mock("@/lib/report-error", () => ({ reportError: reportErrorMock }));

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
    expect(options.connectionTimeoutMillis).toBe(10_000);
  });

  it("registers a pool error listener that reports and does not throw", async () => {
    await import("@/lib/prisma");

    expect(poolOnMock).toHaveBeenCalledWith("error", expect.any(Function));
    const handler = poolOnMock.mock.calls.find((c) => c[0] === "error")![1];
    const error = new Error("Connection terminated unexpectedly");
    expect(() => handler(error)).not.toThrow();
    expect(reportErrorMock).toHaveBeenCalledWith(expect.any(String), error);
  });

  it("retries a read once on a dropped connection but never a write", async () => {
    const { prisma } = (await import("@/lib/prisma")) as unknown as {
      prisma: {
        extension: {
          query: {
            $allOperations: (a: {
              operation: string;
              args: unknown;
              query: (args: unknown) => Promise<unknown>;
            }) => Promise<unknown>;
          };
        };
      };
    };
    const hook = prisma.extension.query.$allOperations;
    const dropped = new Error("Connection terminated unexpectedly");

    const readQuery = vi
      .fn()
      .mockRejectedValueOnce(dropped)
      .mockResolvedValueOnce("ok");
    await expect(
      hook({ operation: "$queryRaw", args: {}, query: readQuery }),
    ).resolves.toBe("ok");
    expect(readQuery).toHaveBeenCalledTimes(2);

    const writeQuery = vi.fn().mockRejectedValue(dropped);
    await expect(
      hook({ operation: "update", args: {}, query: writeQuery }),
    ).rejects.toBe(dropped);
    expect(writeQuery).toHaveBeenCalledTimes(1);
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
