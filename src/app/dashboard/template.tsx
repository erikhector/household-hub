import { ViewTransition } from "react";

// UX-33: tab changes. A template (unlike the layout) mounts afresh each
// time the dashboard's child segment changes (Home → Shopping → Tasks), so
// its <ViewTransition> sees the old page leave and the new one enter: the
// old page fades out quickly and the new one fades in with a small rise
// (vt-page-* in globals.css). Going deeper inside one tab (a list → one
// shopping list) keeps the same child segment, so this stays still and the
// row's title morphs into the page instead (MorphTitle).
//
// `default="none"`: anything else that happens inside the page (a tick, a
// form result) leaves the page as a whole alone.
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition enter="vt-page-enter" exit="vt-page-exit" default="none">
      {children}
    </ViewTransition>
  );
}
