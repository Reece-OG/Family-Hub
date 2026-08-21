import type { MetadataRoute } from "next";
import { APP_NAME } from "@/lib/app-name";

// Next serves this file at /manifest.webmanifest automatically. Keeping
// `display: "standalone"` is what makes Android Chrome and iOS Safari hide
// browser chrome once the app is installed via "Add to Home Screen".

export default function manifest(): MetadataRoute.Manifest {
  return {
    // `id` anchors the app's PWA identity — without it, Chrome derives the id
    // from start_url, which can change if we ever move the root route. Pinning
    // it here prevents a future "app looks like a new install" glitch on
    // upgrades.
    id: "/",
    name: APP_NAME,
    short_name: APP_NAME.length > 12 ? "Family Hub" : APP_NAME,
    description:
      "A self-hosted home and family dashboard — calendar, to-dos, shopping, recipes, maintenance and more.",
    lang: "en",
    dir: "ltr",
    categories: ["productivity", "utilities"],
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0e1016",
    theme_color: "#8338ec",
    icons: [
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/apple-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
      {
        src: "/favicon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
    ],
  };
}
