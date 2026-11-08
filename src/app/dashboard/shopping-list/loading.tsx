import { PageSkeleton } from "@/components/dashboard/page-skeleton";

// This is the skeleton a list card's tap shows first: it's the nearest
// loading.tsx the router knows before the list's own answer arrives
// (`[id]/loading.tsx` follows only once that answer reaches the router).
// When the list page is ready by then, React commits it straight over this
// skeleton, so unless this one carries the list-title morph too there is
// nothing for the card's title to fly into (MAINT-91, same cause as
// MAINT-89). Opening the lists overview itself has no id in the URL, and
// MorphTitleSkeleton then leaves it unnamed.
export default function Loading() {
  return <PageSkeleton variant="rows" morph="shopping-list" />;
}
