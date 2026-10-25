// Tests src/lib/logger.ts's redaction (via the public logger, since redact()
// is private): it is the only thing stopping a careless
// `logger.error("x", { user })` leaking a secret into logs/Sentry.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { excerptForLog, logger } from "./logger";

describe("logger redaction", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  const entry = () => JSON.parse(logSpy.mock.calls[0][0] as string);
  const loggedMeta = (): Record<string, unknown> => entry().meta;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["password", "passwordHash", "clientSecret", "sessionToken", "apiKey", "api_key", "PASSWORD", "AccessToken"])(
    "redacts the value of key %s",
    (key) => {
      logger.info("x", { [key]: "hunter2", keep: "visible" });
      expect(loggedMeta()).toEqual({ [key]: "[REDACTED]", keep: "visible" });
    },
  );

  it("redacts nested objects, including inside arrays", () => {
    logger.info("x", { user: { name: "a", password: "p", deep: { token: "t" } }, list: [{ secret: "s", ok: 1 }] });
    expect(loggedMeta()).toEqual({
      user: { name: "a", password: "[REDACTED]", deep: { token: "[REDACTED]" } },
      list: [{ secret: "[REDACTED]", ok: 1 }],
    });
  });

  it("keeps an Error's name/message/stack and redacts sensitive extra properties", () => {
    const err = Object.assign(new Error("boom"), { digest: "d1", token: "t", nested: { apiKey: "k" } });
    logger.info("x", { error: err });
    const out = loggedMeta().error as Record<string, unknown>;
    expect(out).toMatchObject({ name: "Error", message: "boom", digest: "d1", token: "[REDACTED]" });
    expect(typeof out.stack).toBe("string");
    expect(out.nested).toEqual({ apiKey: "[REDACTED]" });
  });

  it("replaces circular references instead of throwing", () => {
    const a: Record<string, unknown> = { name: "a", password: "p" };
    a.self = a;
    expect(() => logger.info("x", { a })).not.toThrow();
    expect(loggedMeta()).toEqual({ a: { name: "a", password: "[REDACTED]", self: "[Circular]" } });
  });

  it("passes primitives through and omits meta when none is given", () => {
    logger.info("plain", { n: 1, s: "x", b: false, nil: null });
    expect(loggedMeta()).toEqual({ n: 1, s: "x", b: false, nil: null });
    logSpy.mockClear();
    logger.info("no meta");
    expect(entry()).not.toHaveProperty("meta");
  });

  it("routes levels to the matching console method", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.warn("w");
    logger.error("e");
    expect(JSON.parse(warn.mock.calls[0][0] as string)).toMatchObject({ level: "warn", message: "w" });
    expect(JSON.parse(error.mock.calls[0][0] as string)).toMatchObject({ level: "error", message: "e" });
  });
});

describe("excerptForLog", () => {
  it("returns the full length but only the first 200 characters", () => {
    expect(excerptForLog("a".repeat(500))).toEqual({ length: 500, head: "a".repeat(200) });
  });
});
