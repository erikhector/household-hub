// Minimal dependency-free structured logger — no Winston/Pino, no external
// transport. Deliberately simple for this app's scale (a personal
// household-management app run by a single maintainer), the same reasoning
// documented in src/lib/rate-limit.ts for staying in-process instead of
// reaching for infra this app doesn't need. Under the hood this still just
// calls console.log/warn/error — that remains the right primitive for a
// Node/Next server process whose stdout goes to whatever the host's log
// aggregator is. What this module adds over calling console directly is:
//   1. A single consistent, greppable line shape across the app.
//   2. Automatic redaction of obviously secret-shaped fields in `meta`, so a
//      careless `logger.error("failed", { user })` can't leak a password
//      hash or token into logs.

type LogMeta = Record<string, unknown>;

type LogLevel = "info" | "warn" | "error";

// Case-insensitive substring match against key names — deliberately broad
// (matches "passwordHash", "apiKey", "sessionToken", etc.) since it's much
// safer to over-redact an oddly-named-but-harmless field than to under-redact
// a secret.
const SENSITIVE_KEY_PATTERN = /password|secret|token|apikey|api_key/i;

const REDACTED = "[REDACTED]";

function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (value instanceof Error) {
      const errResult: Record<string, unknown> = {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
      // Capture extra own-enumerable properties too (e.g. Next.js's
      // error.digest on errors thrown from a Server Component/Action).
      for (const [key, val] of Object.entries(value)) {
        if (key in errResult) continue;
        errResult[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(val, seen);
      }
      return errResult;
    }

    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(val, seen);
    }
    return result;
  }

  return value;
}

function write(level: LogLevel, message: string, meta?: LogMeta): void {
  const entry = {
    level,
    time: new Date().toISOString(),
    message,
    ...(meta !== undefined ? { meta: redact(meta) } : {}),
  };

  const line = JSON.stringify(entry);

  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info(message: string, meta?: LogMeta): void {
    write("info", message, meta);
  },
  warn(message: string, meta?: LogMeta): void {
    write("warn", message, meta);
  },
  error(message: string, meta?: LogMeta): void {
    write("error", message, meta);
  },
};

// How much of a free-text value excerptForLog keeps. Enough to tell "the
// model wrapped its JSON in a ```json fence" or "it answered in prose" apart
// when debugging, without copying the rest of the value into the logs.
const EXCERPT_MAX_CHARS = 200;

/** Shrinks free text we don't control (an AI model's raw reply, say) to its
 * length plus the first EXCERPT_MAX_CHARS characters before it goes into log
 * `meta`. Key-name redaction above can't help here: the sensitive part is the
 * *content* — a receipt scan's reply can echo card digits or a loyalty
 * number printed further down the receipt — so the safe default is to not
 * log the whole thing at all (BACKLOG SEC-11). */
export function excerptForLog(text: string): { length: number; head: string } {
  return { length: text.length, head: text.slice(0, EXCERPT_MAX_CHARS) };
}
