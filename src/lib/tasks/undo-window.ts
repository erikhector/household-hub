// How long a task tick's "Done" toast offers Undo (the Tasks page and Home's
// Today block), and how long after a tick an un-tick still counts as that
// Undo on the server.
//
// The toast's Undo and a later manual untick reach the server as the same
// toggleTaskCompletedAction call, and the owner's rule for the acorn stash
// is that only the Undo takes the tick's acorn back: unticking a task later
// keeps the acorn the earlier completion earned. The server tells the two
// apart by age alone, an un-tick within TASK_UNDO_WINDOW_MS of the tick
// being the Undo, rather than trusting a flag from the client. The window is
// the toast's lifetime plus a grace: Sonner pauses a toast's timer while it
// is hovered or the tab is hidden, and the Undo's request takes a moment to
// arrive, so a press near the end of the toast still lands inside it. A
// paused toast could still outlast that, so the clients also close it a
// margin before the window ends (src/components/tasks/undo-toast-cap.ts).

/** How long the "Done" toast stays up, offering Undo. */
export const TASK_DONE_TOAST_MS = 5000;

/** An un-tick this soon after the tick is its Undo (toast plus grace). */
export const TASK_UNDO_WINDOW_MS = TASK_DONE_TOAST_MS + 10_000;
