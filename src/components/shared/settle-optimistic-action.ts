"use client";

import { unstable_rethrow } from "next/navigation";
import { toast } from "sonner";

// UX-14: the server half of an optimistic row update (ticking a shopping
// item or a task, a +/- on a stock quantity). The row has already flipped
// via `useOptimistic` by the time this runs; once the transition ends React
// drops the optimistic value and shows the server's, so a failed save rolls
// itself back. All this has to do is make that rollback *visible* (M5: "an
// optimistic update rolls back visibly when the server says no") with a
// toast, and hand a successful result back for any follow-up (the auto-add
// Undo toast, the share page's local state).
//
// Two ways to fail: the action answers `{ error }` (validation, not found,
// rate limit), or the request itself never makes it (weak in-store signal,
// offline), which rejects the action's promise. Before UX-14 nobody caught
// the second one, so it went to the error boundary and took the whole page
// with it; now it's a toast and the row snaps back. Next's own redirect and
// not-found signals (an expired session's `requireHousehold()` redirect) are
// rejections too, and are re-thrown so the router still handles them.
export async function settleOptimisticAction<R extends { error?: string }>(
  action: () => Promise<R>,
  saveFailedMessage: string,
): Promise<R | null> {
  let result: R;
  try {
    result = await action();
  } catch (error) {
    unstable_rethrow(error);
    toast.error(saveFailedMessage);
    return null;
  }
  if (result.error) {
    toast.error(result.error);
    return null;
  }
  return result;
}
