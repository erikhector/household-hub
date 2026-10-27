import type { init } from "@sentry/nextjs";

type DataCollection = NonNullable<NonNullable<Parameters<typeof init>[0]>["dataCollection"]>;

// Sentry 11 replaced `sendDefaultPii` with `dataCollection`, and leaving it
// unset now *collects* by default: user info, cookies, request and response
// headers and bodies, query strings, local variable values in stack frames,
// database query data and more. The privacy page promises error details
// only (message, stack trace, page address, browser), so both Sentry.init()
// calls (src/instrumentation.ts, src/instrumentation-client.ts) pass this,
// which is Sentry's documented equivalent of the v10 default
// (`sendDefaultPii: false`), plus the categories v11 added. Local variables
// matter most here: a Server Action's locals hold form input such as
// emails and passwords.
//
// A plain object with only a type import, so instrumentation-client.ts can
// import it statically without pulling the SDK into the root bundle (PERF-8).
const NETWORK_IDENTITY = ["forwarded", "-ip", "remote-", "via", "-user"];

export const SENTRY_DATA_COLLECTION = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: { deny: NETWORK_IDENTITY },
    response: { deny: NETWORK_IDENTITY },
  },
  httpBodies: [],
  urlQueryParams: { deny: NETWORK_IDENTITY },
  stackFrameVariables: false,
  databaseQueryData: false,
  queues: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
} satisfies DataCollection;
