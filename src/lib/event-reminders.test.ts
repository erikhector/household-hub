// Tests GAP-88a's calendar event reminder pass (src/lib/event-reminders.ts):
// who gets a push, on which run, once per occurrence, and only for the
// household's own events. Prisma and the push sender are mocked; the
// recurrence maths and dictionaries are the real ones.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const {
  userFindManyMock,
  pushSubscriptionFindManyMock,
  householdEventFindManyMock,
  sendCreateMock,
  sendDeleteManyMock,
  sendPushMock,
} = vi.hoisted(() => ({
  userFindManyMock: vi.fn(),
  pushSubscriptionFindManyMock: vi.fn(),
  householdEventFindManyMock: vi.fn(),
  sendCreateMock: vi.fn(),
  sendDeleteManyMock: vi.fn(),
  sendPushMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findMany: userFindManyMock },
    pushSubscription: { findMany: pushSubscriptionFindManyMock },
    householdEvent: { findMany: householdEventFindManyMock },
    eventReminderSend: { create: sendCreateMock, deleteMany: sendDeleteManyMock },
  },
}));
vi.mock("@/lib/push", () => ({ sendPushToHouseholdMembers: sendPushMock }));

const { syncEventReminders } = await import("@/lib/event-reminders");

const d = (key: string) => new Date(`${key}T00:00:00.000Z`);
// The cron's own hour, 06:00 UTC.
const RUN = new Date("2026-12-03T06:00:00Z");

function event(fields: Partial<Record<string, unknown>> = {}) {
  return {
    id: "event-1",
    title: "Zoe's birthday",
    date: d("2026-12-03"),
    startTime: null,
    endTime: null,
    recurrence: null,
    reminder: "MORNING_OF",
    ...fields,
  };
}

beforeEach(() => {
  userFindManyMock.mockResolvedValue([{ id: "user-1", locale: "en" }]);
  pushSubscriptionFindManyMock.mockResolvedValue([]);
  householdEventFindManyMock.mockResolvedValue([event()]);
  sendCreateMock.mockResolvedValue({});
  sendDeleteManyMock.mockResolvedValue({ count: 0 });
  sendPushMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("syncEventReminders", () => {
  it("pushes the morning of an event to an opted-in member, once claimed", async () => {
    await syncEventReminders("household-1", RUN);

    expect(userFindManyMock).toHaveBeenCalledWith({
      where: { eventReminderNudge: true, memberships: { some: { householdId: "household-1" } } },
      select: { id: true, locale: true },
    });
    expect(sendCreateMock).toHaveBeenCalledWith({
      data: { userId: "user-1", eventId: "event-1", occurrenceDate: d("2026-12-03") },
    });
    expect(sendPushMock).toHaveBeenCalledWith("household-1", ["user-1"], {
      title: "Zoe's birthday",
      body: "Today",
      url: "/dashboard/calendar",
    });
  });

  it("reads only the household's own events with a reminder", async () => {
    await syncEventReminders("household-1", RUN);

    expect(householdEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          householdId: "household-1",
          reminder: { not: null },
          date: { lte: d("2026-12-04") },
          OR: [{ recurrence: { not: null } }, { date: { gte: d("2026-12-03") } }],
        },
      }),
    );
    expect(sendDeleteManyMock).toHaveBeenCalledWith({
      where: { event: { householdId: "household-1" }, occurrenceDate: { lt: d("2026-12-03") } },
    });
  });

  it("pushes the day before for a day-before reminder, with the time in the member's language", async () => {
    userFindManyMock.mockResolvedValue([{ id: "user-1", locale: "sv" }]);
    householdEventFindManyMock.mockResolvedValue([
      event({ title: "Tandläkaren", date: d("2026-12-04"), startTime: "14:30", reminder: "DAY_BEFORE" }),
    ]);

    await syncEventReminders("household-1", RUN);

    expect(sendCreateMock).toHaveBeenCalledWith({
      data: { userId: "user-1", eventId: "event-1", occurrenceDate: d("2026-12-04") },
    });
    expect(sendPushMock).toHaveBeenCalledWith("household-1", ["user-1"], {
      title: "Tandläkaren",
      body: "Imorgon, 14:30",
      url: "/dashboard/calendar",
    });
  });

  it("sends nothing for a reminder that isn't due on this run", async () => {
    householdEventFindManyMock.mockResolvedValue([
      // The morning of tomorrow is tomorrow's run.
      event({ date: d("2026-12-04") }),
      // The day before today has passed: never sent late.
      event({ id: "event-2", reminder: "DAY_BEFORE" }),
    ]);

    await syncEventReminders("household-1", RUN);

    expect(sendCreateMock).not.toHaveBeenCalled();
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("reminds each occurrence of a repeat, keyed by that occurrence's day", async () => {
    householdEventFindManyMock.mockResolvedValue([event({ title: "Swimming", date: d("2026-11-19"), recurrence: "WEEKLY" })]);

    await syncEventReminders("household-1", RUN);

    expect(sendCreateMock).toHaveBeenCalledWith({
      data: { userId: "user-1", eventId: "event-1", occurrenceDate: d("2026-12-03") },
    });
    expect(sendPushMock).toHaveBeenCalledTimes(1);
  });

  it("skips the push when an earlier run already sent it", async () => {
    sendCreateMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" }),
    );

    await syncEventReminders("household-1", RUN);

    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("rethrows any other failure to claim", async () => {
    sendCreateMock.mockRejectedValue(new Error("db down"));

    await expect(syncEventReminders("household-1", RUN)).rejects.toThrow("db down");
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("does nothing without an opted-in member", async () => {
    userFindManyMock.mockResolvedValue([]);

    await syncEventReminders("household-1", RUN);

    expect(householdEventFindManyMock).not.toHaveBeenCalled();
    expect(sendPushMock).not.toHaveBeenCalled();
  });

  it("uses the UTC date west of UTC, where the run is still the evening before", async () => {
    // 06:00 UTC on 3 December is 22:00 on the 2nd in Los Angeles.
    pushSubscriptionFindManyMock.mockResolvedValue([{ userId: "user-1", timeZone: "America/Los_Angeles" }]);
    householdEventFindManyMock.mockResolvedValue([
      event({ id: "today-utc" }),
      event({ id: "today-local", date: d("2026-12-02") }),
    ]);

    await syncEventReminders("household-1", RUN);

    expect(sendCreateMock).toHaveBeenCalledTimes(1);
    expect(sendCreateMock).toHaveBeenCalledWith({
      data: { userId: "user-1", eventId: "today-utc", occurrenceDate: d("2026-12-03") },
    });
  });

  it("works out each member's day in their own zone", async () => {
    // 12:00 UTC on 3 December is already the 4th at UTC+14.
    const noon = new Date("2026-12-03T12:00:00Z");
    userFindManyMock.mockResolvedValue([
      { id: "user-utc", locale: "en" },
      { id: "user-east", locale: "en" },
    ]);
    pushSubscriptionFindManyMock.mockResolvedValue([
      { userId: "user-east", timeZone: "Pacific/Kiritimati" },
      { userId: "user-utc", timeZone: "Not/AZone" },
    ]);
    householdEventFindManyMock.mockResolvedValue([event({ date: d("2026-12-04") })]);

    await syncEventReminders("household-1", noon);

    expect(sendPushMock).toHaveBeenCalledTimes(1);
    expect(sendPushMock).toHaveBeenCalledWith("household-1", ["user-east"], expect.objectContaining({ body: "Today" }));
  });
});
