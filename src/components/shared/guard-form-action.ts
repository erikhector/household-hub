import { unstable_rethrow } from "next/navigation";

/** A form's action state, plus the mark `guardFormAction` sets when the
 * request itself never made it (as opposed to the server saying no). */
export type GuardedState<S> = S & { requestFailed?: true };

// UX-210: the form counterpart of settleOptimisticAction (UX-14). A form
// wired straight to `useActionState(serverAction)` has no answer for a
// request that never arrives (offline, a dropped connection): the action's
// promise rejects, nothing catches it, and the error boundary replaces the
// whole page, taking what the user typed with it. On the signed-out pages
// that's a new user's first impression, and Sentry logs it as a crash.
//
// Wrapping the action turns that rejection into an ordinary error state, so
// the form stays on screen and says to check the connection in its own
// error line (M8). React still resets the form once the action settles, so
// the typed values survive through `useKeptFormValues`, exactly as for a
// server-side error. `requestFailed` lets a form whose `error` normally
// belongs to one field (login's, under the password) show this one as a
// general line instead: the password wasn't wrong.
//
// Next's redirect signal is a rejection too (a successful login redirects
// from inside the action), so `unstable_rethrow` passes it on to the router.
export function guardFormAction<S extends { error?: string }>(
  action: (prevState: S, formData: FormData) => Promise<S>,
  requestFailedMessage: string,
): (prevState: GuardedState<S>, formData: FormData) => Promise<GuardedState<S>> {
  return async (prevState, formData) => {
    try {
      return await action(prevState, formData);
    } catch (error) {
      unstable_rethrow(error);
      // Only `error`: whatever the last attempt left (a field marker, a
      // status) is stale now, and every other field of these states is
      // optional.
      return { error: requestFailedMessage, requestFailed: true } as GuardedState<S>;
    }
  };
}
