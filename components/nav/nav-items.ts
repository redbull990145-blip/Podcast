import { Compass, Download, House, Library, ListMusic } from "lucide-react";

/** Shared between the desktop top bar and the mobile tab bar. */
export const NAV_ITEMS = [
  { href: "/home", label: "Home", Icon: House },
  { href: "/library", label: "Library", Icon: Library },
  { href: "/discover", label: "Discover", Icon: Compass },
  { href: "/queue", label: "Up Next", Icon: ListMusic },
  { href: "/downloads", label: "Downloads", Icon: Download },
] as const;

/**
 * The mobile tab bar drops Downloads — it lives one level in, behind Library,
 * and five tabs across a phone leaves each label too narrow to read. Settings
 * is not in either list: on both layouts it sits behind the profile button.
 */
export const MOBILE_NAV_ITEMS = NAV_ITEMS.filter((i) => i.href !== "/downloads");
