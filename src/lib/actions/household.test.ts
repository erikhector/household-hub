// Tests the module-private Zod schemas in src/lib/actions/household.ts
// (createHouseholdSchema / joinSignupSchema) indirectly through the
// exported Server Actions, since the schemas themselves aren't exported.
// All I/O (Prisma, requireHousehold, next/headers, next/cache,
// next/navigation) is mocked — no database is touched. See REQUIREMENTS.md's
// "Testing" section. household.ts has no next-auth/@/lib/auth dependency of
// its own (joinViaInviteSignupAction no longer signs the new account in —
// see its doc comment), so unlike auth.test.ts this file needs no next-auth
// stand-in.
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "@/lib/token-hash";
import { computeBillPositions } from "@/lib/settle-up-calc";

const {
  householdCreateMock,
  householdDeleteMock,
  householdUpdateMock,
  householdUpdateManyMock,
  userFindUniqueMock,
  invitationFindUniqueMock,
  txUserCreateMock,
  invitationFindFirstMock,
  invitationUpdateManyMock,
  householdMemberFindFirstMock,
  householdMemberFindUniqueMock,
  householdMemberDeleteMock,
  householdMemberUpdateMock,
  transactionSplitFindManyMock,
  transactionSplitUpdateMock,
  emailVerificationTokenCreateMock,
  transactionMock,
  requireHouseholdMock,
  requireUserIdMock,
  cookieSetMock,
  headersMock,
  redirectMock,
  revalidatePathMock,
  sendHouseholdInviteEmailMock,
  sendVerificationEmailMock,
  getLocaleMock,
  budgetCategoryFindFirstMock,
} = vi.hoisted(() => ({
  householdCreateMock: vi.fn(),
  householdDeleteMock: vi.fn(),
  householdUpdateMock: vi.fn(),
  householdUpdateManyMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  invitationFindUniqueMock: vi.fn(),
  txUserCreateMock: vi.fn(async (_args: unknown) => ({ id: "new-user" })),
  invitationFindFirstMock: vi.fn(),
  invitationUpdateManyMock: vi.fn(async (): Promise<{ count: number }> => ({ count: 1 })),
  householdMemberFindFirstMock: vi.fn(),
  householdMemberFindUniqueMock: vi.fn(),
  householdMemberDeleteMock: vi.fn(),
  householdMemberUpdateMock: vi.fn(),
  // settleDepartingMemberSplits' two calls (src/lib/settle-departing-member.ts)
  // — findMany defaults to no other members' splits so removeMemberAction/
  // leaveHouseholdAction tests that don't care about splitting keep passing
  // unchanged; individual tests override it.
  transactionSplitFindManyMock: vi.fn(async (): Promise<Array<{ id: string; amountOwed: number }>> => []),
  transactionSplitUpdateMock: vi.fn(async () => ({})),
  emailVerificationTokenCreateMock: vi.fn(async () => ({
    id: "verify-token-row",
    token: "generated-verify-token",
  })),
  // Handles both $transaction call shapes the module uses: an interactive
  // callback (joinViaInviteSignupAction, removeMemberAction,
  // leaveHouseholdAction) and a plain array of already-issued mocked-Prisma
  // calls (transferOwnershipAction) — Prisma's array form just runs each
  // query and resolves with the results, which Promise.all mirrors closely
  // enough for these tests. The interactive callback is handed every
  // sub-client method any of those callers touches, routed to the same
  // top-level mocks so assertions against e.g. householdMemberDeleteMock
  // work whether the module called it directly or through $transaction.
  transactionMock: vi.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return (arg as (tx: unknown) => unknown)({
      user: { create: txUserCreateMock },
      householdMember: { create: vi.fn(async () => ({})), delete: householdMemberDeleteMock },
      invitation: { updateMany: invitationUpdateManyMock },
      transactionSplit: { findMany: transactionSplitFindManyMock, update: transactionSplitUpdateMock },
    });
  }),
  requireHouseholdMock: vi.fn(),
  requireUserIdMock: vi.fn(),
  cookieSetMock: vi.fn(),
  headersMock: vi.fn(async () => new Map()),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
  revalidatePathMock: vi.fn(),
  sendHouseholdInviteEmailMock: vi.fn(async () => ({})),
  sendVerificationEmailMock: vi.fn(async () => ({})),
  getLocaleMock: vi.fn(async () => "en"),
  budgetCategoryFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    household: {
      create: householdCreateMock,
      delete: householdDeleteMock,
      update: householdUpdateMock,
      updateMany: householdUpdateManyMock,
    },
    user: { findUnique: userFindUniqueMock },
    invitation: {
      findUnique: invitationFindUniqueMock,
      findFirst: invitationFindFirstMock,
      update: vi.fn(async () => ({})),
    },
    householdMember: {
      create: vi.fn(async () => ({})),
      findFirst: householdMemberFindFirstMock,
      findUnique: householdMemberFindUniqueMock,
      delete: householdMemberDeleteMock,
      update: householdMemberUpdateMock,
    },
    emailVerificationToken: { create: emailVerificationTokenCreateMock },
    budgetCategory: { findFirst: budgetCategoryFindFirstMock },
    $transaction: transactionMock,
  },
}));
vi.mock("@/lib/session", () => ({
  ACTIVE_HOUSEHOLD_COOKIE: "active_household",
  requireHousehold: requireHouseholdMock,
  requireUserId: requireUserIdMock,
}));
// src/lib/email.ts imports "server-only", which Vitest's Node environment
// can't resolve outside a Next.js build — stub it out.
vi.mock("@/lib/email", () => ({
  sendHouseholdInviteEmail: sendHouseholdInviteEmailMock,
  sendVerificationEmail: sendVerificationEmailMock,
}));
// See the identical note in src/lib/actions/auth.test.ts — avoids pulling in
// next/headers cookies()/@/lib/preferences's auth+Prisma chain transitively.
vi.mock("@/lib/i18n/get-dictionary", () => ({ getLocale: getLocaleMock }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: cookieSetMock })),
  headers: headersMock,
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

const {
  createHouseholdAction,
  acceptInviteAction,
  joinViaInviteSignupAction,
  sendInviteEmailAction,
  removeMemberAction,
  deleteHouseholdAction,
  leaveHouseholdAction,
  transferOwnershipAction,
  switchHouseholdAction,
  dismissGettingStartedAction,
  setAutoAddLowStockToListAction,
  enableCalendarFeedAction,
  regenerateCalendarFeedAction,
  disableCalendarFeedAction,
  setHouseholdCurrencyAction,
  renameHouseholdAction,
  setInventorySyncModeAction,
  setShoppingExpenseCategoryAction,
} = await import("@/lib/actions/household");
const { _resetRateLimitsForTests } = await import("@/lib/rate-limit");

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const originalAppUrl = process.env.APP_URL;

afterEach(() => {
  vi.clearAllMocks();
  _resetRateLimitsForTests();
  redirectMock.mockImplementation((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  });
  headersMock.mockImplementation(async () => new Map());
  emailVerificationTokenCreateMock.mockImplementation(async () => ({
    id: "verify-token-row",
    token: "generated-verify-token",
  }));
  sendVerificationEmailMock.mockImplementation(async () => ({}));
  if (originalAppUrl === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = originalAppUrl;
});

describe("createHouseholdAction validation (createHouseholdSchema)", () => {
  it("rejects an empty name", async () => {
    requireUserIdMock.mockResolvedValue("user-1");

    const result = await createHouseholdAction({}, formData({ name: "  " }));

    expect(result.error).toBe("Household name is required");
    expect(householdCreateMock).not.toHaveBeenCalled();
  });

  // requireUserId rather than requireHousehold, so a user with zero
  // memberships (the no-household page) can create one without being
  // redirected away first.
  it("creates the household, sets the active cookie, and redirects on valid input", async () => {
    requireUserIdMock.mockResolvedValue("user-1");
    householdCreateMock.mockResolvedValue({ id: "new-household" });

    await expect(
      createHouseholdAction({}, formData({ name: "Beach House" })),
    ).rejects.toThrow("REDIRECT:/dashboard");

    expect(householdCreateMock).toHaveBeenCalledWith({
      data: {
        name: "Beach House",
        members: { create: { userId: "user-1", role: "OWNER" } },
      },
    });
    expect(cookieSetMock).toHaveBeenCalledWith(
      "active_household",
      "new-household",
      expect.objectContaining({ path: "/" }),
    );
    expect(requireHouseholdMock).not.toHaveBeenCalled();
  });
});

describe("acceptInviteAction", () => {
  // SEC-8: the loser of a concurrent double-accept must not become a member.
  it("rejects when the invite was redeemed concurrently", async () => {
    requireUserIdMock.mockResolvedValue("user-1");
    invitationFindUniqueMock.mockResolvedValue({
      id: "invite-1",
      householdId: "household-1",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      household: { id: "household-1", name: "The Hectors" },
    });
    householdMemberFindUniqueMock.mockResolvedValue(null);
    invitationUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const result = await acceptInviteAction({}, formData({ token: "invite-token" }));

    expect(result).toEqual({ error: "This invite link is invalid or has expired" });
    expect(cookieSetMock).not.toHaveBeenCalled();
  });

  it("lets a signed-in user with no household join via the invite", async () => {
    requireUserIdMock.mockResolvedValue("user-1");
    invitationFindUniqueMock.mockResolvedValue({
      id: "invite-1",
      householdId: "household-1",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      household: { id: "household-1", name: "The Hectors" },
    });
    householdMemberFindUniqueMock.mockResolvedValue(null);

    await expect(acceptInviteAction({}, formData({ token: "invite-token" }))).rejects.toThrow(
      "REDIRECT:/dashboard",
    );

    expect(requireHouseholdMock).not.toHaveBeenCalled();
    expect(transactionMock).toHaveBeenCalled();
    expect(cookieSetMock).toHaveBeenCalledWith(
      "active_household",
      "household-1",
      expect.objectContaining({ path: "/" }),
    );
  });
});

describe("joinViaInviteSignupAction validation (joinSignupSchema)", () => {
  const validInput = {
    token: "invite-token",
    displayName: "Erik",
    email: "erik@example.com",
    password: "supersecret",
    confirmPassword: "supersecret",
  };

  it("rejects a missing token", async () => {
    const result = await joinViaInviteSignupAction({}, formData({ ...validInput, token: "" }));
    expect(result.error).toBeDefined();
    expect(invitationFindUniqueMock).not.toHaveBeenCalled();
  });

  it("rejects a missing display name", async () => {
    const result = await joinViaInviteSignupAction(
      {},
      formData({ ...validInput, displayName: "" }),
    );
    expect(result.error).toBe("Name is required");
  });

  it("rejects an invalid email", async () => {
    const result = await joinViaInviteSignupAction(
      {},
      formData({ ...validInput, email: "not-an-email" }),
    );
    expect(result.error).toBe("Enter a valid email");
  });

  it("rejects a short password", async () => {
    const result = await joinViaInviteSignupAction(
      {},
      formData({ ...validInput, password: "short" }),
    );
    expect(result.error).toBe("Password must be at least 8 characters");
  });

  it("rejects an invalid or expired invite token once validation passes", async () => {
    invitationFindUniqueMock.mockResolvedValue(null);

    const result = await joinViaInviteSignupAction({}, formData(validInput));

    expect(result.error).toBe("This invite link is invalid or has expired");
  });

  // UX-56: the account locale outranks the cookie after sign-in, so it must
  // be stored from the language the form was shown in.
  it("stores the UI language on the new account", async () => {
    getLocaleMock.mockResolvedValueOnce("sv");
    invitationFindUniqueMock.mockResolvedValue({
      id: "invite-1",
      householdId: "household-1",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      household: { name: "The Hectors" },
    });
    userFindUniqueMock.mockResolvedValue(null);

    await joinViaInviteSignupAction({}, formData(validInput));

    expect(txUserCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ email: validInput.email, locale: "sv" }),
    });
  });

  // joinViaInviteSignupAction no longer signs the new account in — a plain
  // invite link carries no proof the entered email is actually owned by
  // whoever followed it, so it's gated the same as signupAction (see its
  // doc comment in src/lib/actions/household.ts).
  it("joins the household, sends a verification email, and does not sign in for a valid invite", async () => {
    delete process.env.APP_URL;
    invitationFindUniqueMock.mockResolvedValue({
      id: "invite-1",
      householdId: "household-1",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      household: { name: "The Hectors" },
    });
    userFindUniqueMock.mockResolvedValue(null);

    const result = await joinViaInviteSignupAction({}, formData(validInput));

    expect(result).toEqual({ status: "verification-sent", email: validInput.email });
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(cookieSetMock).toHaveBeenCalledWith(
      "active_household",
      "household-1",
      expect.objectContaining({ path: "/" }),
    );
    expect(invitationUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "invite-1", acceptedAt: null },
      data: { acceptedAt: expect.any(Date) },
    });
    // SEC-8: the emailed link carries the raw token, the row only its hash.
    const stored = (emailVerificationTokenCreateMock.mock.calls as unknown as Array<[{ data: { token: string } }]>)[0][0];
    expect(emailVerificationTokenCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "new-user" }),
    });
    const emailed = (sendVerificationEmailMock.mock.calls as unknown as Array<[{ verifyUrl: string }]>)[0][0];
    const raw = emailed.verifyUrl.slice(emailed.verifyUrl.lastIndexOf("/") + 1);
    expect(stored.data.token).toBe(hashToken(raw));
    expect(stored.data.token).not.toBe(raw);
    expect(sendVerificationEmailMock).toHaveBeenCalledWith({
      to: validInput.email,
      verifyUrl: expect.stringMatching(/^http:\/\/localhost:3000\/verify-email\/[0-9a-f-]{36}$/),
      locale: "en",
    });
  });

  // SEC-8: a concurrent request already redeemed the invite between
  // getValidInvitation and the transaction — no account may be created.
  it("creates no account when the invite was redeemed concurrently", async () => {
    invitationFindUniqueMock.mockResolvedValue({
      id: "invite-1",
      householdId: "household-1",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      household: { name: "The Hectors" },
    });
    userFindUniqueMock.mockResolvedValue(null);
    invitationUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const result = await joinViaInviteSignupAction({}, formData(validInput));

    expect(result).toEqual({ error: "This invite link is invalid or has expired" });
    expect(emailVerificationTokenCreateMock).not.toHaveBeenCalled();
    expect(cookieSetMock).not.toHaveBeenCalled();
  });

  // Additive, not a hard dependency (mirrors signupAction) — the account and
  // household membership must still be created even if the verification
  // email fails to send.
  it("still joins the household when sending the verification email fails", async () => {
    invitationFindUniqueMock.mockResolvedValue({
      id: "invite-1",
      householdId: "household-1",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      household: { name: "The Hectors" },
    });
    userFindUniqueMock.mockResolvedValue(null);
    emailVerificationTokenCreateMock.mockRejectedValue(new Error("db down"));

    const result = await joinViaInviteSignupAction({}, formData(validInput));

    expect(result).toEqual({
      status: "verification-sent",
      email: validInput.email,
      emailError: true,
    });
    expect(cookieSetMock).toHaveBeenCalled();
  });
});

// Regression coverage for the host-header-injection fix in
// absoluteAppUrl (src/lib/actions/household.ts): the invite link mailed out
// must come from a trusted source (APP_URL), never straight from
// caller-suppliable request headers — otherwise anyone who can shape their
// own HTTP request (curl, not just a browser) could get a real, valid
// invite token mailed inside a link pointing at a domain of their choosing.
describe("sendInviteEmailAction (absoluteAppUrl trust boundary)", () => {
  const validInvitation = {
    id: "invite-1",
    token: "invite-token",
    householdId: "household-1",
    acceptedAt: null,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
  };

  it("builds the invite URL from APP_URL when it's configured, ignoring request headers", async () => {
    process.env.APP_URL = "https://real-app.example.com/";
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1", name: "The Hectors" } });
    invitationFindFirstMock.mockResolvedValue(validInvitation);
    headersMock.mockResolvedValue(
      new Map([
        ["host", "attacker.example.com"],
        ["x-forwarded-host", "attacker.example.com"],
      ]),
    );

    await sendInviteEmailAction("invite-token", "friend@example.com");

    expect(sendHouseholdInviteEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ inviteUrl: "https://real-app.example.com/join/invite-token" }),
    );
  });

  it("falls back to the Host header only when APP_URL is unset (local-dev convenience)", async () => {
    delete process.env.APP_URL;
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1", name: "The Hectors" } });
    invitationFindFirstMock.mockResolvedValue(validInvitation);
    headersMock.mockResolvedValue(new Map([["host", "localhost:3000"]]));

    await sendInviteEmailAction("invite-token", "friend@example.com");

    expect(sendHouseholdInviteEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ inviteUrl: "http://localhost:3000/join/invite-token" }),
    );
  });
});

// Regression coverage for the SCALE-E fix: any authenticated household
// member could otherwise trigger unlimited outbound emails to arbitrary
// addresses via this app's sending domain. Keyed on the *sender*
// (requireHousehold()'s userId), not the invitee's email or the household,
// so one member being throttled doesn't block a different member of the
// same household from sending invites.
describe("sendInviteEmailAction rate limiting", () => {
  const validInvitation = {
    id: "invite-1",
    token: "invite-token",
    householdId: "household-1",
    acceptedAt: null,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
  };

  it("allows up to the limit of invite emails from the same sender", async () => {
    requireHouseholdMock.mockResolvedValue({
      household: { id: "household-1", name: "The Hectors" },
      userId: "sender-1",
    });
    invitationFindFirstMock.mockResolvedValue(validInvitation);

    for (let i = 0; i < 10; i++) {
      const result = await sendInviteEmailAction("invite-token", `friend${i}@example.com`);
      expect(result.error).toBeUndefined();
    }

    expect(sendHouseholdInviteEmailMock).toHaveBeenCalledTimes(10);
  });

  it("blocks further invite emails from the same sender past the limit", async () => {
    requireHouseholdMock.mockResolvedValue({
      household: { id: "household-1", name: "The Hectors" },
      userId: "sender-1",
    });
    invitationFindFirstMock.mockResolvedValue(validInvitation);

    for (let i = 0; i < 10; i++) {
      await sendInviteEmailAction("invite-token", `friend${i}@example.com`);
    }
    sendHouseholdInviteEmailMock.mockClear();

    const result = await sendInviteEmailAction("invite-token", "eleventh@example.com");

    expect(result.error).toBe("Too many invite emails sent. Please wait a while and try again.");
    expect(sendHouseholdInviteEmailMock).not.toHaveBeenCalled();
  });

  it("does not rate-limit a different sender in the same household", async () => {
    invitationFindFirstMock.mockResolvedValue(validInvitation);

    requireHouseholdMock.mockResolvedValue({
      household: { id: "household-1", name: "The Hectors" },
      userId: "sender-1",
    });
    for (let i = 0; i < 10; i++) {
      await sendInviteEmailAction("invite-token", `friend${i}@example.com`);
    }
    sendHouseholdInviteEmailMock.mockClear();

    requireHouseholdMock.mockResolvedValue({
      household: { id: "household-1", name: "The Hectors" },
      userId: "sender-2",
    });
    const result = await sendInviteEmailAction("invite-token", "friend@example.com");

    expect(result.error).toBeUndefined();
    expect(sendHouseholdInviteEmailMock).toHaveBeenCalledTimes(1);
  });
});

// Owner-only administration + ownership hand-off/leaving. The security
// boundary that matters most here is that every action re-derives its
// target row scoped to the caller's session household — a client-supplied
// member/household id belonging to a DIFFERENT household must never be
// actionable, even though nothing stops a caller from sending one.
describe("removeMemberAction", () => {
  const ownerSession = {
    household: { id: "household-1", name: "The Hectors" },
    role: "OWNER" as const,
    userId: "owner-user",
  };

  it("rejects a non-owner caller", async () => {
    requireHouseholdMock.mockResolvedValue({
      household: { id: "household-1", name: "The Hectors" },
      role: "CONTRIBUTOR",
      userId: "contributor-user",
    });

    const result = await removeMemberAction("member-2");

    expect(result.error).toBe("Only the household owner can remove members");
    expect(householdMemberFindFirstMock).not.toHaveBeenCalled();
    expect(householdMemberDeleteMock).not.toHaveBeenCalled();
  });

  it("rejects a member id that belongs to a different household (forged id)", async () => {
    requireHouseholdMock.mockResolvedValue(ownerSession);
    // Simulates the real query scoping: findFirst is called with
    // householdId: "household-1", so a member row that actually lives under
    // another household would never match and Prisma would return null.
    householdMemberFindFirstMock.mockResolvedValue(null);

    const result = await removeMemberAction("member-in-other-household");

    expect(householdMemberFindFirstMock).toHaveBeenCalledWith({
      where: { id: "member-in-other-household", householdId: "household-1" },
    });
    expect(result.error).toBe("Member not found");
    expect(householdMemberDeleteMock).not.toHaveBeenCalled();
  });

  it("rejects the owner targeting themselves", async () => {
    requireHouseholdMock.mockResolvedValue(ownerSession);
    householdMemberFindFirstMock.mockResolvedValue({
      id: "member-owner",
      householdId: "household-1",
      userId: "owner-user",
      role: "OWNER",
    });

    const result = await removeMemberAction("member-owner");

    expect(result.error).toBe("You can't remove yourself");
    expect(householdMemberDeleteMock).not.toHaveBeenCalled();
  });

  it("rejects targeting the owner", async () => {
    requireHouseholdMock.mockResolvedValue(ownerSession);
    householdMemberFindFirstMock.mockResolvedValue({
      id: "member-other-owner",
      householdId: "household-1",
      userId: "some-other-user",
      role: "OWNER",
    });

    const result = await removeMemberAction("member-other-owner");

    expect(result.error).toBe("The owner can't be removed");
    expect(householdMemberDeleteMock).not.toHaveBeenCalled();
  });

  it("removes a contributor on the happy path", async () => {
    requireHouseholdMock.mockResolvedValue(ownerSession);
    householdMemberFindFirstMock.mockResolvedValue({
      id: "member-2",
      householdId: "household-1",
      userId: "contributor-user",
      role: "CONTRIBUTOR",
    });
    householdMemberDeleteMock.mockResolvedValue({});

    const result = await removeMemberAction("member-2");

    expect(result).toEqual({});
    expect(householdMemberDeleteMock).toHaveBeenCalledWith({ where: { id: "member-2" } });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/household");
  });

  // Regression test for the bug settle-departing-member.ts fixes: before
  // that fix, removing a member who'd paid a shared bill cascade-deleted
  // their split row (with its amountPaid) along with their membership, so a
  // fully-paid bill looked unpaid again for whoever was left. See that
  // file's doc comment and migration
  // 20260925050231_partial_payments_and_settlements's backfill 3, which this
  // mirrors for historical data.
  it("settles the remaining member's share before removing a member who'd paid a shared bill in full", async () => {
    requireHouseholdMock.mockResolvedValue(ownerSession);
    householdMemberFindFirstMock.mockResolvedValue({
      id: "member-b",
      householdId: "household-1",
      userId: "b-user",
      role: "CONTRIBUTOR",
    });
    householdMemberDeleteMock.mockResolvedValue({});
    // A and B split a 6000 rent bill 3000/3000, and B paid it in full. B's
    // own split row (owed 3000, paid 6000) is about to cascade away with
    // their membership — only A's row (owed 3000) is left to settle.
    transactionSplitFindManyMock.mockResolvedValue([{ id: "split-a", amountOwed: 3000 }]);

    const result = await removeMemberAction("member-b");

    expect(result).toEqual({});
    expect(transactionSplitFindManyMock).toHaveBeenCalledWith({
      where: {
        householdMemberId: { not: "member-b" },
        transaction: { splits: { some: { householdMemberId: "member-b" } } },
      },
      select: { id: true, amountOwed: true },
    });
    // A's share is marked paid before B's row (and payment) disappears.
    expect(transactionSplitUpdateMock).toHaveBeenCalledWith({
      where: { id: "split-a" },
      data: { amountPaid: 3000 },
    });
    expect(householdMemberDeleteMock).toHaveBeenCalledWith({ where: { id: "member-b" } });

    // computeBillPositions confirms what that update means for A: with
    // amountPaid now equal to amountOwed, A owes nothing back to the bill
    // and nothing to another member — the bill doesn't regress to "left
    // due"/"unpaid" just because B, who'd actually paid it, left.
    const position = computeBillPositions({
      amount: 3000,
      splits: [{ householdMemberId: "member-a", amountOwed: 3000, amountPaid: 3000 }],
    }).get("member-a");
    expect(position?.owedToBill).toBe(0);
    expect(position?.memberBalance).toBe(0);
  });
});

describe("deleteHouseholdAction", () => {
  it("rejects a non-owner caller", async () => {
    requireHouseholdMock.mockResolvedValue({
      household: { id: "household-1", name: "The Hectors" },
      role: "CONTRIBUTOR",
      households: [
        { id: "household-1", name: "The Hectors", role: "CONTRIBUTOR" },
        { id: "household-2", name: "Lake House", role: "OWNER" },
      ],
    });

    const result = await deleteHouseholdAction();

    expect(result.error).toBe("Only the household owner can delete the household");
    expect(householdDeleteMock).not.toHaveBeenCalled();
  });

  it("rejects deleting the caller's only household", async () => {
    requireHouseholdMock.mockResolvedValue({
      household: { id: "household-1", name: "The Hectors" },
      role: "OWNER",
      households: [{ id: "household-1", name: "The Hectors", role: "OWNER" }],
    });

    const result = await deleteHouseholdAction();

    expect(result.error).toBe("You can't delete your only household. Create another one first.");
    expect(householdDeleteMock).not.toHaveBeenCalled();
  });

  it("deletes the household and falls back the active cookie on the happy path", async () => {
    requireHouseholdMock.mockResolvedValue({
      household: { id: "household-1", name: "The Hectors" },
      role: "OWNER",
      households: [
        { id: "household-1", name: "The Hectors", role: "OWNER" },
        { id: "household-2", name: "Lake House", role: "CONTRIBUTOR" },
      ],
    });
    householdDeleteMock.mockResolvedValue({});

    await expect(deleteHouseholdAction()).rejects.toThrow("REDIRECT:/dashboard");

    expect(householdDeleteMock).toHaveBeenCalledWith({ where: { id: "household-1" } });
    expect(cookieSetMock).toHaveBeenCalledWith(
      "active_household",
      "household-2",
      expect.objectContaining({ path: "/" }),
    );
  });
});

describe("leaveHouseholdAction", () => {
  it("rejects the owner (must transfer or delete instead)", async () => {
    requireHouseholdMock.mockResolvedValue({
      household: { id: "household-1", name: "The Hectors" },
      role: "OWNER",
      userId: "owner-user",
      households: [
        { id: "household-1", name: "The Hectors", role: "OWNER" },
        { id: "household-2", name: "Lake House", role: "CONTRIBUTOR" },
      ],
    });

    const result = await leaveHouseholdAction();

    expect(result.error).toBe(
      "Transfer ownership to another member before leaving, or delete the household instead",
    );
    expect(householdMemberDeleteMock).not.toHaveBeenCalled();
  });

  it("rejects leaving the caller's only household", async () => {
    requireHouseholdMock.mockResolvedValue({
      household: { id: "household-1", name: "The Hectors" },
      role: "CONTRIBUTOR",
      userId: "contributor-user",
      households: [{ id: "household-1", name: "The Hectors", role: "CONTRIBUTOR" }],
    });

    const result = await leaveHouseholdAction();

    expect(result.error).toBe("You can't leave your only household. Create another one first.");
    expect(householdMemberDeleteMock).not.toHaveBeenCalled();
  });

  it("removes the caller's own membership and falls back the active cookie on the happy path", async () => {
    requireHouseholdMock.mockResolvedValue({
      household: { id: "household-1", name: "The Hectors" },
      role: "CONTRIBUTOR",
      userId: "contributor-user",
      households: [
        { id: "household-1", name: "The Hectors", role: "CONTRIBUTOR" },
        { id: "household-2", name: "Lake House", role: "OWNER" },
      ],
    });
    householdMemberFindUniqueMock.mockResolvedValue({
      id: "member-2",
      householdId: "household-1",
      userId: "contributor-user",
      role: "CONTRIBUTOR",
    });
    householdMemberDeleteMock.mockResolvedValue({});

    await expect(leaveHouseholdAction()).rejects.toThrow("REDIRECT:/dashboard");

    expect(householdMemberFindUniqueMock).toHaveBeenCalledWith({
      where: { householdId_userId: { householdId: "household-1", userId: "contributor-user" } },
    });
    expect(householdMemberDeleteMock).toHaveBeenCalledWith({ where: { id: "member-2" } });
    expect(cookieSetMock).toHaveBeenCalledWith(
      "active_household",
      "household-2",
      expect.objectContaining({ path: "/" }),
    );
  });
});

describe("transferOwnershipAction", () => {
  const ownerSession = {
    household: { id: "household-1", name: "The Hectors" },
    role: "OWNER" as const,
    userId: "owner-user",
  };

  it("rejects a non-owner caller", async () => {
    requireHouseholdMock.mockResolvedValue({
      household: { id: "household-1", name: "The Hectors" },
      role: "CONTRIBUTOR",
      userId: "contributor-user",
    });

    const result = await transferOwnershipAction("member-2");

    expect(result.error).toBe("Only the household owner can transfer ownership");
    expect(householdMemberFindUniqueMock).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects a target member id that belongs to a different household (forged id)", async () => {
    requireHouseholdMock.mockResolvedValue(ownerSession);
    householdMemberFindUniqueMock.mockResolvedValue({
      id: "member-owner",
      householdId: "household-1",
      userId: "owner-user",
      role: "OWNER",
    });
    // Scoped findFirst: a member row actually belonging to another
    // household must not match household-1 and so resolves to null.
    householdMemberFindFirstMock.mockResolvedValue(null);

    const result = await transferOwnershipAction("member-in-other-household");

    expect(householdMemberFindFirstMock).toHaveBeenCalledWith({
      where: { id: "member-in-other-household", householdId: "household-1" },
    });
    expect(result.error).toBe("Member not found");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects the owner targeting themselves", async () => {
    requireHouseholdMock.mockResolvedValue(ownerSession);
    householdMemberFindUniqueMock.mockResolvedValue({
      id: "member-owner",
      householdId: "household-1",
      userId: "owner-user",
      role: "OWNER",
    });
    householdMemberFindFirstMock.mockResolvedValue({
      id: "member-owner",
      householdId: "household-1",
      userId: "owner-user",
      role: "OWNER",
    });

    const result = await transferOwnershipAction("member-owner");

    expect(result.error).toBe("You're already the owner");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects a target that is already the owner", async () => {
    requireHouseholdMock.mockResolvedValue(ownerSession);
    householdMemberFindUniqueMock.mockResolvedValue({
      id: "member-owner",
      householdId: "household-1",
      userId: "owner-user",
      role: "OWNER",
    });
    householdMemberFindFirstMock.mockResolvedValue({
      id: "member-co-owner",
      householdId: "household-1",
      userId: "other-owner-user",
      role: "OWNER",
    });

    const result = await transferOwnershipAction("member-co-owner");

    expect(result.error).toBe("This member is already the owner");
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("swaps OWNER/CONTRIBUTOR between caller and target in one transaction on the happy path", async () => {
    requireHouseholdMock.mockResolvedValue(ownerSession);
    householdMemberFindUniqueMock.mockResolvedValue({
      id: "member-owner",
      householdId: "household-1",
      userId: "owner-user",
      role: "OWNER",
    });
    householdMemberFindFirstMock.mockResolvedValue({
      id: "member-2",
      householdId: "household-1",
      userId: "contributor-user",
      role: "CONTRIBUTOR",
    });
    householdMemberUpdateMock.mockImplementation(async (args: { where: { id: string } }) => args);

    const result = await transferOwnershipAction("member-2");

    expect(result).toEqual({});
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(householdMemberUpdateMock).toHaveBeenCalledWith({
      where: { id: "member-owner" },
      data: { role: "CONTRIBUTOR" },
    });
    expect(householdMemberUpdateMock).toHaveBeenCalledWith({
      where: { id: "member-2" },
      data: { role: "OWNER" },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/household");
  });
});

describe("dismissGettingStartedAction (UX-26)", () => {
  it("hides the card for the session's own household only", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" } });

    await dismissGettingStartedAction();

    expect(cookieSetMock).toHaveBeenCalledWith(
      "getting_started_dismissed_household-1",
      "1",
      expect.objectContaining({ path: "/", maxAge: 60 * 60 * 24 * 365 }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
  });

  it("sets nothing when there is no signed-in household", async () => {
    requireHouseholdMock.mockRejectedValue(new Error("REDIRECT:/login"));

    await expect(dismissGettingStartedAction()).rejects.toThrow("REDIRECT:/login");
    expect(cookieSetMock).not.toHaveBeenCalled();
  });
});

describe("switchHouseholdAction", () => {
  it("switches to a household the caller is a member of", async () => {
    requireHouseholdMock.mockResolvedValue({
      households: [
        { id: "household-1", name: "The Hectors", role: "OWNER" },
        { id: "household-2", name: "Lake House", role: "CONTRIBUTOR" },
      ],
    });

    await expect(switchHouseholdAction("household-2")).rejects.toThrow("REDIRECT:/dashboard");

    expect(cookieSetMock).toHaveBeenCalledWith(
      "active_household",
      "household-2",
      expect.objectContaining({ path: "/" }),
    );
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
  });

  it("redirects to an in-app dashboard returnTo after switching", async () => {
    requireHouseholdMock.mockResolvedValue({
      households: [
        { id: "household-1", name: "The Hectors", role: "OWNER" },
        { id: "household-2", name: "Lake House", role: "CONTRIBUTOR" },
      ],
    });

    await expect(
      switchHouseholdAction("household-2", "/dashboard/budget?month=2026-09"),
    ).rejects.toThrow("REDIRECT:/dashboard/budget?month=2026-09");
    expect(cookieSetMock).toHaveBeenCalledWith("active_household", "household-2", expect.anything());
  });

  it.each([
    "https://evil.example/dashboard",
    "//evil.example/dashboard",
    "/\evil.example",
    "/dashboard\..\evil",
    "/dashboardevil",
    "/login",
  ])("falls back to /dashboard for an unsafe returnTo (%s)", async (returnTo) => {
    requireHouseholdMock.mockResolvedValue({
      households: [
        { id: "household-1", name: "The Hectors", role: "OWNER" },
        { id: "household-2", name: "Lake House", role: "CONTRIBUTOR" },
      ],
    });

    await expect(switchHouseholdAction("household-2", returnTo)).rejects.toThrow(/^REDIRECT:\/dashboard$/);
  });

  it("no-ops for a household id the caller isn't a member of (forged id)", async () => {
    requireHouseholdMock.mockResolvedValue({
      households: [{ id: "household-1", name: "The Hectors", role: "OWNER" }],
    });

    const result = await switchHouseholdAction("household-belonging-to-someone-else");

    expect(result).toBeUndefined();
    expect(cookieSetMock).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("setAutoAddLowStockToListAction (AUTO-8)", () => {
  it("updates only the session's active household, for any member (not owner-gated)", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "CONTRIBUTOR" });
    householdUpdateMock.mockResolvedValue({});

    const result = await setAutoAddLowStockToListAction(false);

    expect(result).toEqual({});
    expect(householdUpdateMock).toHaveBeenCalledWith({
      where: { id: "household-1" },
      data: { autoAddLowStockToList: false },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/household");
  });

  it("turns it back on", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "OWNER" });
    householdUpdateMock.mockResolvedValue({});

    await setAutoAddLowStockToListAction(true);

    expect(householdUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { autoAddLowStockToList: true } }),
    );
  });

  it("rejects a non-boolean value from a hand-crafted request", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "OWNER" });

    const result = await setAutoAddLowStockToListAction("false" as unknown as boolean);

    expect(result.error).toBeDefined();
    expect(householdUpdateMock).not.toHaveBeenCalled();
  });
});

describe("setShoppingExpenseCategoryAction", () => {
  it("points shopping at one of the session household's expense categories, for any member", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "CONTRIBUTOR" });
    budgetCategoryFindFirstMock.mockResolvedValue({ id: "cat-food" });
    householdUpdateMock.mockResolvedValue({});

    const result = await setShoppingExpenseCategoryAction("cat-food");

    expect(result).toEqual({});
    expect(budgetCategoryFindFirstMock).toHaveBeenCalledWith({
      where: { id: "cat-food", householdId: "household-1", type: "EXPENSE" },
      select: { id: true },
    });
    expect(householdUpdateMock).toHaveBeenCalledWith({
      where: { id: "household-1" },
      data: { shoppingExpenseCategoryId: "cat-food" },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/household");
  });

  it("refuses a category that isn't one of this household's expense categories", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "OWNER" });
    // Another household's category, or an income/savings one: the scoped
    // lookup finds nothing either way.
    budgetCategoryFindFirstMock.mockResolvedValue(null);

    const result = await setShoppingExpenseCategoryAction("cat-elsewhere");

    expect(result.error).toBe("Category not found");
    expect(householdUpdateMock).not.toHaveBeenCalled();
  });

  it("clears the pick with null, going back to the automatic Groceries", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "OWNER" });
    householdUpdateMock.mockResolvedValue({});

    const result = await setShoppingExpenseCategoryAction(null);

    expect(result).toEqual({});
    expect(budgetCategoryFindFirstMock).not.toHaveBeenCalled();
    expect(householdUpdateMock).toHaveBeenCalledWith({
      where: { id: "household-1" },
      data: { shoppingExpenseCategoryId: null },
    });
  });

  it("rejects a malformed value from a hand-crafted request", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "OWNER" });

    const result = await setShoppingExpenseCategoryAction(42 as unknown as string);

    expect(result.error).toBeDefined();
    expect(householdUpdateMock).not.toHaveBeenCalled();
  });
});

describe("calendar feed actions (GAP-3)", () => {
  const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

  it.each([
    ["enable", () => enableCalendarFeedAction()],
    ["regenerate", () => regenerateCalendarFeedAction()],
    ["disable", () => disableCalendarFeedAction()],
  ])("%s is owner-only", async (_name, run) => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "CONTRIBUTOR" });

    const result = await run();

    expect(result.error).toBe("Only the household owner can manage the calendar feed");
    expect(householdUpdateMock).not.toHaveBeenCalled();
    expect(householdUpdateManyMock).not.toHaveBeenCalled();
  });

  it("enable sets a fresh 32-byte token only while the feed is off", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "OWNER" });
    householdUpdateManyMock.mockResolvedValue({ count: 1 });

    const result = await enableCalendarFeedAction();

    expect(result).toEqual({});
    const call = householdUpdateManyMock.mock.calls[0][0];
    // The null filter is what makes a repeat click a no-op instead of a
    // silent regenerate.
    expect(call.where).toEqual({ id: "household-1", calendarFeedToken: null });
    expect(call.data.calendarFeedToken).toMatch(TOKEN_PATTERN);
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/household");
  });

  it("regenerate replaces the token with a different one each time", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "OWNER" });
    householdUpdateMock.mockResolvedValue({});

    await regenerateCalendarFeedAction();
    await regenerateCalendarFeedAction();

    const [first, second] = householdUpdateMock.mock.calls.map((c) => c[0]);
    expect(first.where).toEqual({ id: "household-1" });
    expect(first.data.calendarFeedToken).toMatch(TOKEN_PATTERN);
    expect(second.data.calendarFeedToken).toMatch(TOKEN_PATTERN);
    expect(first.data.calendarFeedToken).not.toBe(second.data.calendarFeedToken);
  });

  it("disable clears the token for the session's household only", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "OWNER" });
    householdUpdateMock.mockResolvedValue({});

    const result = await disableCalendarFeedAction();

    expect(result).toEqual({});
    expect(householdUpdateMock).toHaveBeenCalledWith({
      where: { id: "household-1" },
      data: { calendarFeedToken: null },
    });
  });

  it("returns a friendly error when the write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "OWNER" });
    householdUpdateMock.mockRejectedValue(new Error("db down"));

    const result = await disableCalendarFeedAction();

    expect(result.error).toBeTruthy();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("setHouseholdCurrencyAction (GAP-13)", () => {
  it("is owner-only", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "CONTRIBUTOR" });

    const result = await setHouseholdCurrencyAction("EUR");

    expect(result.error).toBeTruthy();
    expect(householdUpdateMock).not.toHaveBeenCalled();
  });

  it("stores the normalized code on the session's household and revalidates the dashboard", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "OWNER" });
    householdUpdateMock.mockResolvedValue({});

    const result = await setHouseholdCurrencyAction(" eur ");

    expect(result).toEqual({});
    expect(householdUpdateMock).toHaveBeenCalledWith({
      where: { id: "household-1" },
      data: { currencyCode: "EUR" },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard", "layout");
  });

  it.each([[null], [""]])("clears the setting for %j", async (value) => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "OWNER" });
    householdUpdateMock.mockResolvedValue({});

    const result = await setHouseholdCurrencyAction(value);

    expect(result).toEqual({});
    expect(householdUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ data: { currencyCode: null } }));
  });

  it("rejects a code off the allow-list without writing", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "OWNER" });

    const result = await setHouseholdCurrencyAction("JPY");

    expect(result.error).toBeTruthy();
    expect(householdUpdateMock).not.toHaveBeenCalled();
  });

  it("returns a friendly error when the write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "OWNER" });
    householdUpdateMock.mockRejectedValue(new Error("db down"));

    const result = await setHouseholdCurrencyAction("SEK");

    expect(result.error).toBeTruthy();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("renameHouseholdAction (UX-75)", () => {
  it("is owner-only", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "CONTRIBUTOR" });

    const result = await renameHouseholdAction("New name");

    expect(result.error).toBeTruthy();
    expect(householdUpdateMock).not.toHaveBeenCalled();
  });

  it("renames the session's household with the trimmed name and revalidates the dashboard", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "OWNER" });
    householdUpdateMock.mockResolvedValue({});

    const result = await renameHouseholdAction("  The Flat  ");

    expect(result).toEqual({});
    expect(householdUpdateMock).toHaveBeenCalledWith({
      where: { id: "household-1" },
      data: { name: "The Flat" },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard", "layout");
  });

  it.each([[""], ["   "], ["x".repeat(61)]])("rejects %j without writing", async (value) => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "OWNER" });

    const result = await renameHouseholdAction(value);

    expect(result.error).toBeTruthy();
    expect(householdUpdateMock).not.toHaveBeenCalled();
  });

  it("returns a friendly error when the write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "OWNER" });
    householdUpdateMock.mockRejectedValue(new Error("db down"));

    const result = await renameHouseholdAction("Home");

    expect(result.error).toBeTruthy();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("setInventorySyncModeAction (put-away)", () => {
  it("lets the owner switch the session's household to put-away mode", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "OWNER" });
    householdUpdateMock.mockResolvedValue({});

    const result = await setInventorySyncModeAction("ON_PUT_AWAY");

    expect(result).toEqual({});
    expect(householdUpdateMock).toHaveBeenCalledWith({
      where: { id: "household-1" },
      data: { inventorySyncMode: "ON_PUT_AWAY" },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/household");
  });

  it("refuses a contributor", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "CONTRIBUTOR" });

    const result = await setInventorySyncModeAction("ON_CHECK");

    expect(result.error).toBe("Only the household owner can change when inventory is updated");
    expect(householdUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a value that isn't a mode", async () => {
    requireHouseholdMock.mockResolvedValue({ household: { id: "household-1" }, role: "OWNER" });

    const result = await setInventorySyncModeAction("WHENEVER");

    expect(result.error).toBe("Invalid input");
    expect(householdUpdateMock).not.toHaveBeenCalled();
  });
});
