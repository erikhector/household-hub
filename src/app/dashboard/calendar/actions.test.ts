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
  householdEventFindManyMock,
  householdEventCreateManyMock,
  getTimeZoneMock,
  checkRateLimitMock,
} = vi.hoisted(() => ({
  requireHouseholdMock: vi.fn(),
  householdEventCreateMock: vi.fn(),
  householdEventUpdateManyMock: vi.fn(),
  householdEventDeleteManyMock: vi.fn(),
  householdMemberFindFirstMock: vi.fn(),
  revalidatePathMock: vi.fn(),
  householdEventFindManyMock: vi.fn(),
  householdEventCreateManyMock: vi.fn(),
  getTimeZoneMock: vi.fn(async () => "UTC"),
  checkRateLimitMock: vi.fn(async () => true),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    householdEvent: {
      create: householdEventCreateMock,
      updateMany: householdEventUpdateManyMock,
      deleteMany: householdEventDeleteManyMock,
      findMany: householdEventFindManyMock,
      createMany: householdEventCreateManyMock,
    },
    householdMember: { findFirst: householdMemberFindFirstMock },
  },
}));
vi.mock("@/lib/session", () => ({ requireHousehold: requireHouseholdMock }));
vi.mock("next/cache", () => ({ revalidatePath: revalidatePathMock }));
vi.mock("@/lib/get-time-zone", () => ({ getTimeZone: getTimeZoneMock }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: checkRateLimitMock }));

// Empty by default so errors fall back to English; a test of a translated
// error swaps in `sv` for one call.
const { getDictionaryMock } = vi.hoisted(() => ({ getDictionaryMock: vi.fn(async (): Promise<unknown> => ({})) }));
vi.mock("@/lib/i18n/get-dictionary", () => ({ getDictionary: getDictionaryMock, getLocale: vi.fn(async () => "en") }));

const { createEventAction, updateEventAction, deleteEventAction, previewEventFileAction, importEventFileAction } =
  await import("@/app/dashboard/calendar/actions");

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

// GAP-92: "Import from file". The .ics parser has its own tests
// (src/lib/ics-import.test.ts); these cover what the actions add: tenancy,
// who imported it, re-parsing the file rather than trusting the client, and
// the duplicate skip.
describe("event file import", () => {
  const ICS = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "SUMMARY:Swimming",
    "DTSTART:20270312T170000",
    "DTEND:20270312T180000",
    "RRULE:FREQ=WEEKLY;BYDAY=FR",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "SUMMARY:Sports day",
    "DTSTART;VALUE=DATE:20270315",
    "DESCRIPTION:Bring water",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "SUMMARY:",
    "DTSTART;VALUE=DATE:20270316",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "SUMMARY:Parents' evening",
    "DTSTART:20270320T180000Z",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");

  function upload(indexes: number[] = [], text = ICS) {
    const fd = new FormData();
    fd.set("file", new File([text], "school.ics", { type: "text/calendar" }));
    for (const index of indexes) fd.append("index", String(index));
    return fd;
  }

  function signedInWithDictionary() {
    signedIn();
    getDictionaryMock.mockResolvedValue(en);
  }

  afterEach(() => {
    getDictionaryMock.mockResolvedValue({});
    getTimeZoneMock.mockResolvedValue("UTC");
    checkRateLimitMock.mockResolvedValue(true);
  });

  describe("previewEventFileAction", () => {
    it("lists the readable events with their repeat, flags one already in the household, and saves nothing", async () => {
      signedInWithDictionary();
      householdEventFindManyMock.mockResolvedValueOnce([
        { title: "  sports DAY ", date: new Date("2027-03-15T00:00:00.000Z") },
      ]);

      const result = await previewEventFileAction({}, upload());

      expect(result.error).toBeUndefined();
      expect(result.preview?.skipped).toBe(1); // the event with no title
      expect(result.preview?.rows).toEqual([
        expect.objectContaining({ index: 0, title: "Swimming", timeLabel: "5:00 PM–6:00 PM", repeatLabel: "Weekly", exists: false }),
        expect.objectContaining({ index: 1, title: "Sports day", timeLabel: "All day", repeatLabel: null, exists: true }),
        expect.objectContaining({ index: 3, title: "Parents' evening", exists: false }),
      ]);
      expect(householdEventFindManyMock).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ householdId: "household-1" }) }),
      );
      expect(householdEventCreateManyMock).not.toHaveBeenCalled();
    });

    it("refuses what isn't a calendar file, and a file over the cap without reading it", async () => {
      signedInWithDictionary();

      expect((await previewEventFileAction({}, upload([], "name,date\n"))).error).toBe(en.calendar.importFile.errorUnsupported);
      expect((await previewEventFileAction({}, upload([], "x".repeat(256 * 1024 + 1)))).error).toBe(
        en.calendar.importFile.errorTooLarge,
      );
      expect((await previewEventFileAction({}, new FormData())).error).toBe(en.calendar.importFile.errorNoFile);
    });

    it("stops a household that's over the rate limit", async () => {
      signedInWithDictionary();
      checkRateLimitMock.mockResolvedValueOnce(false);

      const result = await previewEventFileAction({}, upload());

      expect(result.error).toBe(en.calendar.importFile.errorRateLimited);
      expect(checkRateLimitMock).toHaveBeenCalledWith("event-file-import:household-1", expect.any(Number), expect.any(Number));
    });
  });

  describe("importEventFileAction", () => {
    it("re-reads the file and writes only the ticked rows, in the session's household, added by the caller", async () => {
      signedInWithDictionary();
      householdEventFindManyMock.mockResolvedValueOnce([]);
      householdMemberFindFirstMock.mockResolvedValueOnce({ id: "member-me" });
      // A forged "for" member, created-by or household in the form is never read.
      const fd = upload([0, 3]);
      fd.set("householdId", "household-other");
      fd.set("createdByMemberId", "member-other");

      const result = await importEventFileAction({}, fd);

      expect(result).toEqual({ imported: 2 });
      expect(householdMemberFindFirstMock).toHaveBeenCalledWith({
        where: { householdId: "household-1", userId: "user-1" },
        select: { id: true },
      });
      expect(householdEventCreateManyMock).toHaveBeenCalledWith({
        data: [
          {
            householdId: "household-1",
            createdByMemberId: "member-me",
            forMemberId: null,
            reminder: null,
            title: "Swimming",
            date: new Date("2027-03-12T00:00:00.000Z"),
            startTime: "17:00",
            endTime: "18:00",
            notes: null,
            recurrence: "WEEKLY",
          },
          {
            householdId: "household-1",
            createdByMemberId: "member-me",
            forMemberId: null,
            reminder: null,
            title: "Parents' evening",
            date: new Date("2027-03-20T00:00:00.000Z"),
            startTime: "18:00",
            endTime: null,
            notes: null,
            recurrence: null,
          },
        ],
      });
      expect(revalidatePathMock).toHaveBeenCalledWith("/dashboard/calendar");
    });

    it("never trusts rows sent by the client: only the file's own events, by index, are written", async () => {
      signedInWithDictionary();
      householdEventFindManyMock.mockResolvedValueOnce([]);
      householdMemberFindFirstMock.mockResolvedValueOnce({ id: "member-me" });
      const fd = upload([1, 1, 2, 99, -1]);
      fd.set("title", "Injected");
      fd.append("rows", JSON.stringify([{ title: "Injected", date: "2027-01-01" }]));

      const result = await importEventFileAction({}, fd);

      // Index 1 once; 2 is the untitled event the schema refuses; 99 and -1 aren't rows.
      expect(result).toEqual({ imported: 1 });
      const { data } = householdEventCreateManyMock.mock.calls[0][0] as { data: { title: string; notes: string | null }[] };
      expect(data).toEqual([expect.objectContaining({ title: "Sports day", notes: "Bring water" })]);
    });

    it("moves a zoned time into the importer's time zone", async () => {
      signedInWithDictionary();
      getTimeZoneMock.mockResolvedValue("Europe/Stockholm");
      householdEventFindManyMock.mockResolvedValueOnce([]);
      householdMemberFindFirstMock.mockResolvedValueOnce({ id: "member-me" });

      await importEventFileAction({}, upload([3]));

      const { data } = householdEventCreateManyMock.mock.calls[0][0] as { data: { startTime: string }[] };
      expect(data[0].startTime).toBe("19:00");
    });

    it("skips an event whose title and date are already there, so a second import adds nothing", async () => {
      signedInWithDictionary();
      householdEventFindManyMock.mockResolvedValueOnce([
        { title: "Swimming", date: new Date("2027-03-12T00:00:00.000Z") },
        { title: "Sports day", date: new Date("2027-03-15T00:00:00.000Z") },
      ]);

      const result = await importEventFileAction({}, upload([0, 1]));

      expect(result.error).toBe(en.calendar.importFile.errorNothingNew);
      expect(householdEventCreateManyMock).not.toHaveBeenCalled();
    });

    it("writes the rest when only some are already there, and one twice in the file once", async () => {
      signedInWithDictionary();
      householdEventFindManyMock.mockResolvedValueOnce([{ title: "Swimming", date: new Date("2027-03-12T00:00:00.000Z") }]);
      householdMemberFindFirstMock.mockResolvedValueOnce({ id: "member-me" });
      const twice = ICS.replace(
        "END:VCALENDAR",
        "BEGIN:VEVENT\r\nSUMMARY:Sports Day\r\nDTSTART;VALUE=DATE:20270315\r\nEND:VEVENT\r\nEND:VCALENDAR",
      );

      const result = await importEventFileAction({}, upload([0, 1, 4], twice));

      expect(result).toEqual({ imported: 1 });
      const { data } = householdEventCreateManyMock.mock.calls[0][0] as { data: { title: string }[] };
      expect(data.map((row) => row.title)).toEqual(["Sports day"]);
    });

    it("asks for a selection when nothing valid is ticked", async () => {
      signedInWithDictionary();

      const result = await importEventFileAction({}, upload([]));

      expect(result.error).toBe(en.calendar.importFile.errorNoneSelected);
      expect(householdEventCreateManyMock).not.toHaveBeenCalled();
    });

    it("turns a database failure into a friendly error", async () => {
      signedInWithDictionary();
      householdEventFindManyMock.mockResolvedValueOnce([]);
      householdMemberFindFirstMock.mockResolvedValueOnce({ id: "member-me" });
      householdEventCreateManyMock.mockRejectedValueOnce(new Error("db down"));

      const result = await importEventFileAction({}, upload([0]));

      expect(result.error).toBeTruthy();
      expect(revalidatePathMock).not.toHaveBeenCalled();
    });
  });
});
