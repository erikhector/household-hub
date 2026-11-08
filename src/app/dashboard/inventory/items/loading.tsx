import { PageSkeleton } from "@/components/dashboard/page-skeleton";

// This is the skeleton a catalogue row's tap shows first: it's the nearest
// loading.tsx the router knows before the item's own answer arrives. When
// the item page is ready by then, React commits it straight over this
// skeleton, so unless this one carries the item-name morph too there is
// nothing for the row's title to fly into (MAINT-89). Opening the catalogue
// itself has no id in the URL, and MorphTitleSkeleton then leaves it unnamed.
export default function Loading() {
  return <PageSkeleton variant="table" back morph="inventory-item" />;
}
