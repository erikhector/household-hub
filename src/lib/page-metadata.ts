import type { Metadata } from "next";
import { getDictionary } from "@/lib/i18n/get-dictionary";

// UX-64: the one place a public page's <title> and link preview are built, so
// every route names itself the same way and the og:/twitter: tags can't drift
// from the title.
//
// The root layout's title template appends " · Squirrel", so a page passes
// only its own name ("Log in"). A child's `openGraph` replaces the parent's
// outright rather than merging, which is why each page gets the full set from
// here instead of the layout carrying it once.
//
// The preview image is the 512 px app icon: a square mark reads fine in the
// small thumbnail WhatsApp and iMessage draw beside the text, and it needs no
// per-page rendering. Relative on purpose; the layout's `metadataBase` (from
// APP_URL) turns it into the absolute URL crawlers require.
const PREVIEW_IMAGE = { url: "/icon-512-maskable.png", width: 512, height: 512, alt: "Squirrel" };

export async function titleOnlyMetadata(title: string): Promise<Metadata> {
  const dict = await getDictionary();
  return buildMetadata({ title, description: dict.meta.fallbackDescription });
}

export function buildMetadata({
  title,
  description,
  absoluteTitle,
}: {
  title: string;
  description: string;
  // The landing page's title stands alone ("Squirrel: ...") rather than
  // taking the " · Squirrel" suffix.
  absoluteTitle?: boolean;
}): Metadata {
  const shown = absoluteTitle ? title : `${title} · Squirrel`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    openGraph: {
      type: "website",
      siteName: "Squirrel",
      title: shown,
      description,
      images: [PREVIEW_IMAGE],
    },
    twitter: {
      card: "summary",
      title: shown,
      description,
      images: [PREVIEW_IMAGE.url],
    },
  };
}
