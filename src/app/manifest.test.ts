import { describe, expect, it } from "vitest";
import manifest from "./manifest";

// GAP-68: home-screen shortcuts must deep-link into the app and carry an icon.
// GAP-67: Android lists the installed app in the share sheet through this.
describe("manifest share_target", () => {
  it("is a GET to the dashboard share route with title, text and url", () => {
    expect(manifest().share_target).toEqual({
      action: "/dashboard/share",
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    });
  });
});

describe("manifest shortcuts", () => {
  const { shortcuts } = manifest();

  it("declares Shopping list, Meal plan and Tasks", () => {
    expect(shortcuts?.map((s) => s.name)).toEqual(["Shopping list", "Meal plan", "Tasks"]);
  });

  it.each(shortcuts ?? [])("$name points into the dashboard and has an icon", (s) => {
    expect(s.url.startsWith("/dashboard/")).toBe(true);
    expect(s.short_name).toBeTruthy();
    expect(s.icons?.length).toBeGreaterThan(0);
    expect(s.icons?.[0].sizes).toBe("96x96");
  });
});
