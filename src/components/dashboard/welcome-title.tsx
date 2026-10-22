"use client";

import { useEffect } from "react";

// UX-135: the overview is opened with `?welcome=1` straight after a
// verification link signs the user in. The title says it once; this drops the
// query from the address bar (history.replaceState, which Next syncs with its
// router) so a reload or a bookmark shows the ordinary greeting instead of
// welcoming them again.
export function WelcomeTitle({ text }: { text: string }) {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("welcome")) {
      url.searchParams.delete("welcome");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, []);
  return <>{text}</>;
}
