import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // A stable id keeps an installed app attached to this entry even if
    // start_url ever changes.
    id: "/",
    name: "Cadence — podcasts, properly",
    short_name: "Cadence",
    description:
      "A fast, private podcast player with AI show notes, real cross-device sync, and no lock-in.",
    start_url: "/library",
    display: "standalone",
    orientation: "portrait",
    background_color: "#15161c",
    theme_color: "#15161c",
    categories: ["entertainment", "music", "news"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        // A separate file, not the same one reused: a maskable icon is
        // cropped to a platform-chosen shape, so it needs a full-bleed
        // background and its artwork kept inside the safe zone. Pointing
        // `maskable` at the rounded-corner icon leaves transparent wedges.
        src: "/icon-maskable.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Up Next", url: "/queue" },
      { name: "Library", url: "/library" },
      { name: "Downloads", url: "/downloads" },
    ],
  };
}
