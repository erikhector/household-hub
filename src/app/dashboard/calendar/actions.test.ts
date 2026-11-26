// Tests the household calendar's Server Actions (GAP-35): validation, the
// household-scoping guards and the happy paths. All I/O (Prisma,
// requireHousehold, next/cache) is mocked, no database is touched. Same
// convention as src/app/dashboard/household/notes-actions.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { sv } from "@/lib/i18n/dictionaries/sv";
import { en } from "@/lib/i18n/dictionaries/en";

const {
  requireHouseholdMock,
  householdEventCreateMock,
  householdEventUpdateManyMock,
  householdEventDeleteManyMock,
  householdMemberFindFirstMock,
  revalidatePathMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  householdEventCreateMock: vi.fn(),
  householdEventUpdateManyMock: vi.fn(),
  householdEventDeleteManyMock: vi.fn(),
  householdMemberFindFirstMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    householdEvent: {
      create: householdEventCreateMock,
      updateMany: householdEventUpdateManyMock,
      deleteMany: householdEventDeleteManyMock,
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

const { createEventAction, updateEventAction, deleteEventAction } = await import("@/app/dashboard/calendar/actions");

const household = { id: "household-1", name: "The Hectors" };

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries({
    title: "Dentist",
    date: "2026-12-03",
    startTime: "",
    endTime: "",
    notes: "",
    forMemberId: "",
    recurrence: "",
    reminder: "",
    ...fields,
  })) {
    fd.set(key, value);
  }
  return fd;
}

function signedIn() {
  requireHouseholdMock.mockResolvedValue({ household, userId: "user-1" });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("createEventAction", () => {
  it("creates an all-day one-off in the session's household, added by the caller", async () => {
    signedIn();
    householdMemberFindFirstMock.mockResolvedValueOnce({ id: "member-me" });

    const result = await createEventAction({}, formData({ title: "  Zoe's birthday  " }));

    expect(result).toEqual({});
    expect(householdMemberFindFirstMock).toHaveBeenCalledWith({
      where: { householdId: "household-1", userId: "user-1" },
      select: { id: true },
    });
    expect(householdEventCreateMock).toHaveBeenCalledWith({
      data: {
        householdId: "household-1",
        createdByMemberId: "member-me",
        title: "Zoe's birthday",
        date: new Date("2026-12-03T00:00:00.000Z"),
        startTime: null,
        endTime: null,
        notes: null,
        forMemberId: null,
        recurrence: null,
        reminder: null,
      },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/calendar");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard");
  });

  it("saves times, notes, a repeat and the member it's for once that member is checked", async () => {
    signedIn();
    householdMemberFindFirstMock.mockResolvedValueOnce({ id: "member-zoe" }).mockResolvedValueOnce({ id: "member-me" });

    const result = await createEventAction(
      {},
      formData({
        startTime: "14:30",
        endTime: "15:15",
        notes: "Bring the card\r\n",
        forMemberId: "member-zoe",
        recurrence: "YEARLY",
      }),
    );

    expect(result).toEqual({});
    expect(householdMemberFindFirstMock).toHaveBeenNthCalledWith(1, {
      where: { id: "member-zoe", householdId: "household-1" },
      select: { id: true },
    });
    expect(householdEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        startTime: "14:30",
        endTime: "15:15",
        notes: "Bring the card",
        forMemberId: "member-zoe",
        recurrence: "YEARLY",
      }),
    });
  });

  it("refuses a member from another household", async () => {
    signedIn();
    householdMemberFindFirstMock.mockResolvedValueOnce(null);

    const result = await createEventAction({}, formData({ forMemberId: "member-elsewhere" }));

    expect(result.error).toBe(en.errors.memberNotFound);
    expect(householdEventCreateMock).not.toHaveBeenCalled();
  });

  it("requires a title", async () => {
    signedIn();

    const result = await createEventAction({}, formData({ title: "   " }));

    expect(result.error).toBe(en.errors.titleRequired);
    expect(householdEventCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a date that doesn't exist", async () => {
    signedIn();

    const result = await createEventAction({}, formData({ date: "2026-02-30" }));

    expect(result.error).toBe(en.errors.eventDateInvalid);
  });

  it("rejects a time that isn't HH:MM", async () => {
    signedIn();

    const result = await createEventAction({}, formData({ startTime: "25:00" }));

    expect(result.error).toBe(en.errors.eventTimeInvalid);
  });

  it("rejects an end time with no start time", async () => {
    signedIn();

    const result = await createEventAction({}, formData({ endTime: "10:00" }));

    expect(result.error).toBe(en.errors.eventEndNeedsStart);
  });

  it("rejects an end time at or before the start", async () => {
    signedIn();

    const result = await createEventAction({}, formData({ startTime: "10:00", endTime: "10:00" }));

    expect(result.error).toBe(en.errors.eventEndBeforeStart);
    expect(householdEventCreateMock).not.toHaveBeenCalled();
  });

  it("saves a reminder choice (GAP-88a)", async () => {
    signedIn();
    householdMemberFindFirstMock.mockResolvedValueOnce({ id: "member-me" });

    expect(await createEventAction({}, formData({ reminder: "MORNING_OF" }))).toEqual({});
    expect(householdEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({ reminder: "MORNING_OF" }),
    });
  });

  it("rejects an unknown reminder", async () => {
    signedIn();

    const result = await createEventAction({}, formData({ reminder: "AN_HOUR_BEFORE" }));

    expect(result.error).toBe(en.errors.invalidInput);
    expect(householdEventCreateMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown repeat", async () => {
    signedIn();

    const result = await createEventAction({}, formData({ recurrence: "DAILY" }));

    expect(result.error).toBe(en.errors.invalidInput);
  });

  it("returns the validation error in the user's language", async () => {
    signedIn();
    getDictionaryMock.mockResolvedValueOnce(sv);

    const result = await createEventAction({}, formData({ startTime: "10:00", endTime: "09:00" }));

    expect(result.error).toBe(sv.errors.eventEndBeforeStart);
  });

  it("turns a database failure into a friendly error", async () => {
    signedIn();
    householdMemberFindFirstMock.mockResolvedValueOnce({ id: "member-me" });
    householdEventCreateMock.mockRejectedValueOnce(new Error("db down"));

    const result = await createEventAction({}, formData({}));

    expect(result.error).toBeTruthy();
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });
});

describe("updateEventAction", () => {
  it("updates the event scoped to the session's household", async () => {
    signedIn();
    householdEventUpdateManyMock.mockResolvedValueOnce({ count: 1 });

    const result = await updateEventAction("event-1", {}, formData({ title: "Dentist (moved)", date: "2026-12-04" }));

    expect(result).toEqual({});
    expect(householdEventUpdateManyMock).toHaveBeenCalledWith({
      where: { id: "event-1", householdId: "household-1" },
      data: expect.objectContaining({ title: "Dentist (moved)", date: new Date("2026-12-04T00:00:00.000Z") }),
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/calendar");
  });

  it("says the event wasn't found for another household's id", async () => {
    signedIn();
    householdEventUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    const result = await updateEventAction("event-elsewhere", {}, formData({}));

    expect(result.error).toBe(en.errors.eventNotFound);
    expect(revalidatePathMock).not.toHaveBeenCalled();
  });

  it("validates before writing anything", async () => {
    signedIn();

    const result = await updateEventAction("event-1", {}, formData({ title: "" }));

    expect(result.error).toBe(en.errors.titleRequired);
    expect(householdEventUpdateManyMock).not.toHaveBeenCalled();
  });
});

describe("deleteEventAction", () => {
  it("deletes only within the session's household", async () => {
    signedIn();
    householdEventDeleteManyMock.mockResolvedValueOnce({ count: 1 });

    const result = await deleteEventAction("event-1");

    expect(result).toEqual({});
    expect(householdEventDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "event-1", householdId: "household-1" },
    });
    expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/calendar");
  });

  it("turns a database failure into a friendly error", async () => {
    signedIn();
    householdEventDeleteManyMock.mockRejectedValueOnce(new Error("db down"));

    const result = await deleteEventAction("event-1");

    expect(result.error).toBeTruthy();
  });
});
