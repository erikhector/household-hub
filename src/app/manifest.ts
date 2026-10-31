import type { MetadataRoute } from "next";
import { SHARE_PATH } from "@/lib/share-target";

// GAP-68: long-press-the-icon jump-offs (Android Chrome/Edge; iOS ignores
// them). A manifest is a static, cookie-less route, so these names are
// English whatever the household's locale cookie says. The 96 px icon is the
// app icon, the size Chrome asks shortcuts for.
const SHORTCUT_ICON = { src: "/icon-96.png", sizes: "96x96", type: "image/png" };

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
  // the app's original look) instead of the old fixed brand purple, so the
  // installed app's task-switcher/splash chrome matches the page behind it.
  theme_color: "#0a0414",
    // GAP-67: Android Chrome/Edge list the installed app in the share sheet;
    // iOS Safari has no Web Share Target. The route only redirects to a
    // dialog with the shared link/text pre-filled (src/lib/share-target.ts).
    share_target: {
      action: SHARE_PATH,
      method: "GET",
      params: { title: "title", text: "text", url: "url" },
    },
    shortcuts: [
      {
        name: "Shopping list",
        short_name: "Shopping",
        url: "/dashboard/shopping-list",
        icons: [SHORTCUT_ICON],
      },
      {
        name: "Meal plan",
        short_name: "Meals",
        url: "/dashboard/meal-planning",
        icons: [SHORTCUT_ICON],
      },
      {
        name: "Tasks",
        short_name: "Tasks",
        url: "/dashboard/tasks",
        icons: [SHORTCUT_ICON],
      },
    ],
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
