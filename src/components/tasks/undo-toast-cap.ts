import { toast } from "sonner";
import { TASK_UNDO_WINDOW_MS } from "@/lib/tasks/undo-window";

// A task tick's "Done" toast (the Tasks page and Home's Today block) must
// never offer Undo after the server would stop treating the un-tick as that
// Undo (TASK_UNDO_WINDOW_MS, undo-window.ts): a late press would reopen the
// task but keep the acorn the tick earned. The toast's own duration isn't
// enough, because Sonner pauses its timer while the toast is hovered, the
// stack is expanded or the tab is hidden, so it can stay up indefinitely.
// This puts a hard stop on it, timed from the tick, a margin short of the
// window so a press at the last moment still reaches the server inside it.
//
// The timer isn't tied to the component that showed the toast: the toast
// lives in the app-wide Toaster and its Undo still reaches the server after
// that component unmounts (say, a tick on Home and then a tap into Tasks),
// so the stop has to outlive it too. It touches no React state, clears
// itself when the toast closes any other way, and ends within the window.

/** Room for the Undo's request to reach the server inside the window. */
const UNDO_REQUEST_MARGIN_MS = 3000;

/** How long after a tick its toast may offer Undo at most. */
export const TASK_UNDO_TOAST_CAP_MS = TASK_UNDO_WINDOW_MS - UNDO_REQUEST_MARGIN_MS;

export function capUndoToast() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const close = () => {
    closed = true;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  return {
    /** Spread into the toast's options, and into any later update of it. */
    closeHandlers: { onDismiss: close, onAutoClose: close },
    /** Start the stop for the toast just shown. */
    start(id: string | number) {
      timer = setTimeout(() => {
        close();
        toast.dismiss(id);
      }, TASK_UNDO_TOAST_CAP_MS);
    },
    /** True once the toast has gone, so an update must not show it again. */
    get closed() {
      return closed;
    },
  };
}
