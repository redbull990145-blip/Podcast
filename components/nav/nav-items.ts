import {
  Compass,
  Download,
  House,
  Library,
  ListMusic,
  SlidersHorizontal,
} from "lucide-react";

/** The desktop top bar's sections. */
export const NAV_ITEMS = [
  { href: "/home", label: "Home", Icon: House },
  { href: "/library", label: "Library", Icon: Library },
  { href: "/discover", label: "Discover", Icon: Compass },
  { href: "/queue", label: "Up Next", Icon: ListMusic },
  { href: "/downloads", label: "Downloads", Icon: Download },
] as const;

/**
 * The phone's tab bar.
 *
 * Five destinations rather than the desktop's five-plus-profile, and the fifth
 * is not the same as the desktop's fifth. On a phone the whole of the app's
 * chrome is this bar — there is no logo, no search field and no profile button
 * beside it — so Settings has to be a destination here or it is unreachable.
 * Downloads gives up the slot: it is one level in behind Library, and it is the
 * only section whose contents are already restated on Home.
 *
 * "You" rather than "Settings" because the label sits at 10px under a 20px
 * icon, and "Settings" is the one word in the set that cannot be read at that
 * size without crowding its neighbours.
 */
export const MOBILE_TAB_ITEMS = [
  { href: "/home", label: "Home", Icon: House },
  { href: "/library", label: "Library", Icon: Library },
  { href: "/discover", label: "Discover", Icon: Compass },
  { href: "/queue", label: "Up Next", Icon: ListMusic },
  { href: "/settings", label: "You", Icon: SlidersHorizontal },
] as const;
