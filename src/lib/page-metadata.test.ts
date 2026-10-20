import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/i18n/get-dictionary", () => ({
  getDictionary: async () => ({ meta: { fallbackDescription: "fallback text" } }),
}));

import { buildMetadata, titleOnlyMetadata } from "./page-metadata";

describe("buildMetadata", () => {
  it("passes the bare name as the title and puts the brand suffix in the preview", () => {
    const m = buildMetadata({ title: "Join Smiths", description: "d" });
    expect(m.title).toBe("Join Smiths");
    expect(m.openGraph).toMatchObject({ title: "Join Smiths · Squirrel", description: "d" });
    expect(m.twitter).toMatchObject({ title: "Join Smiths · Squirrel" });
  });

  it("keeps an absolute title free of the suffix", () => {
    const m = buildMetadata({ title: "Squirrel: home", description: "d", absoluteTitle: true });
    expect(m.title).toEqual({ absolute: "Squirrel: home" });
    expect(m.openGraph).toMatchObject({ title: "Squirrel: home" });
  });

  it("always carries a preview image", () => {
    const m = buildMetadata({ title: "x", description: "d" });
    expect(m.openGraph?.images).toEqual([expect.objectContaining({ url: "/icon-512-maskable.png" })]);
  });
});

describe("titleOnlyMetadata", () => {
  it("falls back to the generic description", async () => {
    const m = await titleOnlyMetadata("Log in");
    expect(m.description).toBe("fallback text");
  });
});
