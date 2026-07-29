import { Compass, Download, Library, ListMusic, Settings } from "lucide-react";

/** Shared between the desktop sidebar and the mobile tab bar. */
export const NAV_ITEMS = [
  { href: "/library", label: "Library", Icon: Library },
  { href: "/discover", label: "Discover", Icon: Compass },
  { href: "/queue", label: "Up Next", Icon: ListMusic },
  { href: "/downloads", label: "Downloads", Icon: Download },
  { href: "/settings", label: "Settings", Icon: Settings },
] as const;

/** The mobile tab bar drops Settings — it lives behind the profile row instead. */
export const MOBILE_NAV_ITEMS = NAV_ITEMS.filter((i) => i.href !== "/settings");
