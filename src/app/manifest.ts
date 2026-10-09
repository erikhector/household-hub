import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Squirrel",
    short_name: "Squirrel",
    description: "Inventory, shopping, meal planning, and budgeting for your household.",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#0a0a0a",
    // UX-29: aligned with the dark page ground (globals.css --gradient-end,
  // the per-scheme value layout.tsx's viewport themeColor carries for dark —
  // the app's default theme) instead of the old fixed brand purple, so the
  // installed app's task-switcher/splash chrome matches the page behind it.
  theme_color: "#0a0414",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
