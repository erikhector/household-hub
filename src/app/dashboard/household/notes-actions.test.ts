// Tests the module-private Zod schema plus the household-scoping guards in
// src/app/dashboard/household/notes-actions.ts, indirectly through the
// exported Server Actions. All I/O (Prisma, requireHousehold, next/cache) is
// mocked — no database is touched. Same convention as
// src/app/dashboard/tasks/actions.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { NOTE_BODY_MAX_LENGTH, NOTE_PIN_MAX } from "@/lib/household-notes";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { en } from "@/lib/i18n/dictionaries/en";

const {
  requireHouseholdMock,
  householdNoteCreateMock,
  householdNoteDeleteManyMock,
  householdNoteUpdateManyMock,
  householdNoteCountMock,
  householdMemberFindFirstMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  householdNoteCreateMock: vi.fn(),
  householdNoteDeleteManyMock: vi.fn(),
  householdNoteUpdateManyMock: vi.fn(),
  householdNoteCountMock: vi.fn(),
  householdMemberFindFirstMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    householdNote: {
      create: householdNoteCreateMock,
      deleteMany: householdNoteDeleteManyMock,
      updateMany: householdNoteUpdateManyMock,
      count: householdNoteCountMock,
    },
    householdMember: { findFirst: householdMemberFindFirstMock },
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));

// Empty by default so errors fall back to English; a test of a translated
// error swaps in `sv` for one call.
const { getDictionaryMock } = vi.hoisted(() => ({ getDictionaryMock: vi.fn(async (): Promise<unknown> => ({})) }));
vi.mock("@/lib/i18n/get-dictionary", () => ({ getDictionary: getDictionaryMock, getLocale: vi.fn(async () => "en") }));

const { createNoteAction, deleteNoteAction, setNotePinnedAction } = await import("@/app/dashboard/household/notes-actions");

const household = { id: "household-1", name: "The Hectors" };

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("createNoteAction", () => {
  it("rejects an empty or whitespace-only body", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });

    const result = await createNoteAction({}, formData({ body: "   \n  " }));

    expect(result.error).toBe("Note can't be empty");
    expect(householdNoteCreateMock).not.toHaveBeenCalled();
  });

  it("returns the validation error in the user's language", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    getDictionaryMock.mockResolvedValueOnce(sv);

    const result = await createNoteAction({}, formData({ body: "  " }));

    expect(result.error).toBe(sv.errors.noteEmpty);
  });

  it("rejects a missing body field", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });

    const result = await createNoteAction({}, formData({}));

    expect(result.error).toBe("Note can't be empty");
    expect(householdNoteCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a body over the max length", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });

    const result = await createNoteAction({}, formData({ body: "x".repeat(NOTE_BODY_MAX_LENGTH + 1) }));

    expect(result.error).toBe(en.errors.householdNoteTooLong);
    // The dictionary text hardcodes the limit; this catches the two drifting apart.
    expect(en.errors.householdNoteTooLong).toContain(String(NOTE_BODY_MAX_LENGTH));
    expect(householdNoteCreateMock).not.toHaveBeenCalled();
  });

  it("accepts a body of exactly the max length once trimmed", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1" });

    const body = "x".repeat(NOTE_BODY_MAX_LENGTH);
    const result = await createNoteAction({}, formData({ body: `  ${body}  ` }));

    expect(result).toEqual({});
    expect(householdNoteCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", authorMemberId: "member-1", body },
    });
  });

  it("scopes to the session household and resolves the author from the session user, ignoring forged form fields", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1" });

    const result = await createNoteAction(
      {},
      formData({
        body: "  Plumber's coming Thursday  ",
        householdId: "household-evil",
        authorMemberId: "member-evil",
      }),
    );

    expect(result).toEqual({});
    expect(householdMemberFindFirstMock).toHaveBeenCalledWith({
      where: { householdId: "household-1", userId: "user-1" },
      select: { id: true },
    });
    expect(householdNoteCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", authorMemberId: "member-1", body: "Plumber's coming Thursday" },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/household");
  });

  it("keeps the note (unattributed) if the member row vanished mid-request", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdMemberFindFirstMock.mockResolvedValue(null);

    const result = await createNoteAction({}, formData({ body: "Out of the good coffee" }));

    expect(result).toEqual({});
    expect(householdNoteCreateMock).toHaveBeenCalledWith({
      data: { householdId: "household-1", authorMemberId: null, body: "Out of the good coffee" },
    });
  });

  it("returns a friendly error when the insert fails", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdMemberFindFirstMock.mockResolvedValue({ id: "member-1" });
    householdNoteCreateMock.mockRejectedValue(new Error("db down"));

    const result = await createNoteAction({}, formData({ body: "Hello" }));

    expect(result.error).toBe("Something went wrong. Please try again.");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("deleteNoteAction", () => {
  it("deletes scoped to the session household", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdNoteDeleteManyMock.mockResolvedValue({ count: 1 });

    const result = await deleteNoteAction("note-1");

    expect(result).toEqual({});
    expect(householdNoteDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "note-1", householdId: "household-1" },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/household");
  });

  it("is a silent no-op for a note id from another household (forged id)", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    // The householdId filter means another household's note never matches.
    householdNoteDeleteManyMock.mockResolvedValue({ count: 0 });

    const result = await deleteNoteAction("note-from-household-2");

    expect(result).toEqual({});
    expect(householdNoteDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "note-from-household-2", householdId: "household-1" },
    });
  });

  it("isn't gated on role or authorship — a contributor can delete any note", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-2", role: "CONTRIBUTOR" });
    householdNoteDeleteManyMock.mockResolvedValue({ count: 1 });

    const result = await deleteNoteAction("note-by-someone-else");

    expect(result).toEqual({});
    expect(householdMemberFindFirstMock).not.toHaveBeenCalled();
    expect(householdNoteDeleteManyMock).toHaveBeenCalledTimes(1);
  });

  it("returns a friendly error when the delete fails", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdNoteDeleteManyMock.mockRejectedValue(new Error("db down"));

    const result = await deleteNoteAction("note-1");

    expect(result.error).toBe("Something went wrong. Please try again.");
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("setNotePinnedAction", () => {
  it("pins a note scoped to the session household with a pinnedAt timestamp", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdNoteCountMock.mockResolvedValue(0);

    const result = await setNotePinnedAction("note-1", true);

    expect(result).toEqual({});
    expect(householdNoteCountMock).toHaveBeenCalledWith({
      where: { householdId: "household-1", pinnedAt: { not: null }, id: { not: "note-1" } },
    });
    expect(householdNoteUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "note-1", householdId: "household-1" },
      data: { pinnedAt: expect.any(Date) },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/household");
  });

  it("refuses a sixth pin and writes nothing", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdNoteCountMock.mockResolvedValue(NOTE_PIN_MAX);

    const result = await setNotePinnedAction("note-6", true);

    expect(result.error).toBe(en.errors.notePinLimit);
    expect(householdNoteUpdateManyMock).not.toHaveBeenCalled();
  });

  it("allows pinning while below the cap", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdNoteCountMock.mockResolvedValue(NOTE_PIN_MAX - 1);

    expect(await setNotePinnedAction("note-5", true)).toEqual({});
    expect(householdNoteUpdateManyMock).toHaveBeenCalledTimes(1);
  });

  it("unpins by clearing pinnedAt, even when the board is at the cap", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdNoteCountMock.mockResolvedValue(NOTE_PIN_MAX);

    const result = await setNotePinnedAction("note-1", false);

    expect(result).toEqual({});
    expect(householdNoteCountMock).not.toHaveBeenCalled();
    expect(householdNoteUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "note-1", householdId: "household-1" },
      data: { pinnedAt: null },
    });
  });

  it("scopes by the session household, so another household's note id changes nothing", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdNoteCountMock.mockResolvedValue(0);
    householdNoteUpdateManyMock.mockResolvedValue({ count: 0 });

    const result = await setNotePinnedAction("note-of-another-household", true);

    expect(result).toEqual({});
    expect(householdNoteUpdateManyMock.mock.calls[0][0].where.householdId).toBe("household-1");
  });

  it("returns the cap error in the user's language", async () => {
    requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
    householdNoteCountMock.mockResolvedValue(NOTE_PIN_MAX);
    getDictionaryMock.mockResolvedValueOnce(sv);

    const result = await setNotePinnedAction("note-6", true);

    expect(result.error).toBe(sv.errors.notePinLimit);
  });
});
