import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
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
        src: "/icon.svg",
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
