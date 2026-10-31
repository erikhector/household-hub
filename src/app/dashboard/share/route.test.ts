import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => auth() }));

import { GET } from "./route";

const call = (query: string) => GET(new NextRequest(`http://localhost:3000/dashboard/share${query}`));

describe("GET /dashboard/share", () => {
  beforeEach(() => {
    auth.mockReset();
    auth.mockResolvedValue({ user: { id: "u1" } });
  });

  it("redirects a url to the recipe import", async () => {
    const res = await call("?url=https%3A%2F%2Fexample.com%2Fpasta");
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/dashboard/meal-planning");
    expect(location.searchParams.get("tab")).toBe("recipes");
    expect(location.searchParams.get("importUrl")).toBe("https://example.com/pasta");
  });

  it("redirects text to the shopping list's paste dialog", async () => {
    const res = await call("?text=Milk%201%20l%0AEggs");
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/dashboard/shopping-list");
    expect(location.searchParams.get("pasteText")).toBe("Milk 1 l\nEggs");
  });

  it("falls back to the dashboard and never leaves the origin", async () => {
    for (const query of ["", "?title=Hi", "?next=https://evil.com", "?url=//evil.com&text="]) {
      const res = await call(query);
      const location = new URL(res.headers.get("location")!);
      expect(location.origin).toBe("http://localhost:3000");
      expect(location.pathname.startsWith("/dashboard")).toBe(true);
    }
  });

  it("sends a logged-out sharer through login and back", async () => {
    auth.mockResolvedValue(null);
    const res = await call("?text=Milk");
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/dashboard/share?text=Milk");
  });
});
