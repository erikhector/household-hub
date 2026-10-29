// Tests createShareLinkAction/revokeShareLinkAction in
// src/app/dashboard/shopping-list/share-actions.ts. All I/O (Prisma,
// requireHousehold, next/headers, next/cache) is mocked — no database or
// network call is made. See REQUIREMENTS.md's "Testing" section and the
// identical convention in src/app/dashboard/shopping-list/list-actions.test.ts /
// src/lib/actions/household.test.ts (whose sendInviteEmailAction tests this
// module's absoluteAppUrl mirrors).
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  requireHouseholdMock,
  shoppingListFindFirstMock,
  shareLinkFindFirstMock,
  shareLinkCreateMock,
  shareLinkUpdateMock,
  headersMock,
  revalidatePathMock,
  randomUUIDMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  shoppingListFindFirstMock: vi.fn(),
  shareLinkFindFirstMock: vi.fn(),
  shareLinkCreateMock: vi.fn(),
  shareLinkUpdateMock: vi.fn(),
  headersMock: vi.fn(async () => new Map()),
  revalidatePathMock: vi.fn(),
  randomUUIDMock: vi.fn(() => "generated-token"),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    shoppingList: { findFirst: shoppingListFindFirstMock },
    shoppingListShareLink: {
      findFirst: shareLinkFindFirstMock,
      create: shareLinkCreateMock,
      update: shareLinkUpdateMock,
    },
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("crypto", () => ({ randomUUID: randomUUIDMock }));

const { createShareLinkAction, revokeShareLinkAction } = await import(
  "@/app/dashboard/shopping-list/share-actions"
);

const household = { id: "household-1" };
const originalAppUrl = process.env.APP_URL;

afterEach(() => {
  vi.clearAllMocks();
  requireHouseholdMock.mockResolvedValue({ household });
  headersMock.mockImplementation(async () => new Map());
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
});
requireHouseholdMock.mockResolvedValue({ household });

describe("createShareLinkAction", () => {
  it("refuses when the list isn't owned by the caller's household", async () => {
    shoppingListFindFirstMock.mockResolvedValue(null);

    const result = await createShareLinkAction("someone-elses-list");

    expect(result.error).toBe("Shopping list not found");
    expect(shareLinkCreateMock).not.toHaveBeenCalled();
  });

  it("reuses an existing active link instead of creating a duplicate", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1", householdId: "household-1" });
    shareLinkFindFirstMock.mockResolvedValue({ id: "link-1", token: "existing-token" });
    process.env.APP_URL = "https://app.example.com";

    const result = await createShareLinkAction("list-1");

    expect(shareLinkCreateMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      url: "https://app.example.com/share/shopping-list/existing-token",
      shareLinkId: "link-1",
    });
  });

  it("creates a fresh link with a random token when no active link exists", async () => {
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1", householdId: "household-1" });
    shareLinkFindFirstMock.mockResolvedValue(null);
    shareLinkCreateMock.mockResolvedValue({ id: "link-new", token: "generated-token" });
    process.env.APP_URL = "https://app.example.com";

    const result = await createShareLinkAction("list-1");

    expect(shareLinkCreateMock).toHaveBeenCalledWith({
      data: { shoppingListId: "list-1", token: "generated-token" },
    });
    expect(result.url).toBe("https://app.example.com/share/shopping-list/generated-token");
  });

  // Mirrors sendInviteEmailAction's absoluteAppUrl trust boundary
  // (src/lib/actions/household.ts / household.test.ts): the share URL must
  // come from APP_URL when configured, never a caller-forgeable header.
  it("builds the URL from APP_URL when configured, ignoring request headers", async () => {
    process.env.APP_URL = "https://real-app.example.com/";
    shoppingListFindFirstMock.mockResolvedValue({ id: "list-1", householdId: "household-1" });
    shareLinkFindFirstMock.mockResolvedValue({ id: "link-1", token: "tok" });
    headersMock.mockResolvedValue(new Map([["host", "attacker.example.com"]]));

    const result = await createShareLinkAction("list-1");

    expect(result.url).toBe("https://real-app.example.com/share/shopping-list/tok");
  });
});

describe("revokeShareLinkAction", () => {
  it("refuses when the link doesn't belong to a list in the caller's household", async () => {
    shareLinkFindFirstMock.mockResolvedValue(null);

    const result = await revokeShareLinkAction("someone-elses-link");

    expect(result.error).toBe("Share link not found");
    expect(shareLinkUpdateMock).not.toHaveBeenCalled();
  });

  it("sets revokedAt on a link that belongs to the caller's household", async () => {
    shareLinkFindFirstMock.mockResolvedValue({ id: "link-1", shoppingListId: "list-1" });
    shareLinkUpdateMock.mockResolvedValue({});

    const result = await revokeShareLinkAction("link-1");

    expect(result).toEqual({});
    expect(shareLinkUpdateMock).toHaveBeenCalledWith({
      where: { id: "link-1" },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
