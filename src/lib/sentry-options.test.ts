import { describe, expect, it } from "vitest";
import { sentryDataCollection } from "./sentry-options";

// Guards the no-new-PII promise made on the privacy page: Sentry 11's
// default for an unset `dataCollection` is permissive.
describe("sentryDataCollection", () => {
  it("collects no user info, cookies, bodies or query data", () => {
    expect(sentryDataCollection.userInfo).toBe(false);
    expect(sentryDataCollection.cookies).toBe(false);
    expect(sentryDataCollection.httpBodies).toEqual([]);
    expect(sentryDataCollection.databaseQueryData).toBe(false);
    expect(sentryDataCollection.genAI).toEqual({ inputs: false, outputs: false });
    expect(sentryDataCollection.queues).toBe(false);
  });
});
