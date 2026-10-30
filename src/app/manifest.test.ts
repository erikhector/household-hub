import { describe, expect, it } from "vitest";
import manifest from "./manifest";

// GAP-68: home-screen shortcuts must deep-link into the app and carry an icon.
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
