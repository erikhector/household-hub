import { beforeEach, describe, expect, it, vi } from "vitest";

const { toast, archive, unarchive } = vi.hoisted(() => ({
  toast: Object.assign(vi.fn(), { error: vi.fn() }),
  archive: vi.fn(),
  unarchive: vi.fn(),
}));

vi.mock("sonner", () => ({ toast }));
vi.mock("@/app/dashboard/shopping-list/list-actions", () => ({
  archiveShoppingListAction: archive,
  unarchiveShoppingListAction: unarchive,
}));

import { archiveListWithUndo } from "./archive-list";

const dict = { listArchivedToast: "List archived", undo: "Undo" };

describe("archiveListWithUndo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("archives, says so, and offers an Undo that unarchives", async () => {
    archive.mockResolvedValue({});
    unarchive.mockResolvedValue({});
    await archiveListWithUndo("list-1", dict);

    expect(archive).toHaveBeenCalledWith("list-1");
    expect(toast).toHaveBeenCalledTimes(1);
    const [message, options] = toast.mock.calls[0];
    expect(message).toBe("List archived");
    expect(options.action.label).toBe("Undo");

    options.action.onClick();
    expect(unarchive).toHaveBeenCalledWith("list-1");
  });

  it("toasts the error and offers no Undo when archiving fails", async () => {
    archive.mockResolvedValue({ error: "Nope" });
    await archiveListWithUndo("list-1", dict);

    expect(toast.error).toHaveBeenCalledWith("Nope");
    expect(toast).not.toHaveBeenCalled();
  });

  it("toasts the error when the Undo's unarchive fails", async () => {
    archive.mockResolvedValue({});
    unarchive.mockResolvedValue({ error: "Gone" });
    await archiveListWithUndo("list-1", dict);

    toast.mock.calls[0][1].action.onClick();
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Gone"));
  });
});
