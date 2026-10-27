// Sentry init options shared by the server (src/instrumentation.ts) and the
// browser (src/instrumentation-client.ts). Deliberately imports nothing, so
// the client can use it without pulling @sentry/nextjs into the root bundle
// (PERF-8).
//
// @sentry/nextjs 11 replaced `sendDefaultPii` with `dataCollection`, and an
// unset `dataCollection` now collects user info (incl. IP), cookies, request
// bodies and database query data. The privacy page promises only the error
// message, stack trace and basic request context, so this pins v10's
// restrictive default (the "preserves the v10 default" block of Sentry's v11
// migration guide). Never remove it, and never set `sendDefaultPii`.
const IP_AND_PROXY_HEADERS = {
  deny: ["forwarded", "-ip", "remote-", "via", "-user"],
};

export const sentryDataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: IP_AND_PROXY_HEADERS,
    response: IP_AND_PROXY_HEADERS,
  },
  httpBodies: [],
  urlQueryParams: IP_AND_PROXY_HEADERS,
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  graphQL: { document: false, variables: false },
};
