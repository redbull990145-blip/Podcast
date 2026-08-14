import { icon } from '@cue/design';
import type { MessageKey } from '@cue/i18n';
import type { Route } from 'next';

export type NavItem = {
  href: Route;
  /**
   * A catalog key, not a label.
   *
   * These are module-level constants, so a translated string baked in here
   * would be resolved once at import time and stay in whichever language the
   * module first loaded under — surviving every language change afterwards.
   * Holding the key defers the lookup to render, where the locale is known.
   */
  label: MessageKey;
  /** Inline SVG path data — see `NavIcon`. */
  icon: string;
};

/**
 * Four destinations, and no more.
 *
 * A media app earns its speed partly by having few places to be: every extra
 * tab is a decision the user makes before they can listen to anything. Queue
 * earns its place because it is the only screen whose *order* is the content —
 * it cannot be a section of another page without becoming a list you can read
 * but not rearrange.
 */
export const navItems: NavItem[] = [
  { href: '/' as Route, label: 'nav.home', icon: icon.home },
  { href: '/search' as Route, label: 'nav.search', icon: icon.search },
  { href: '/library' as Route, label: 'nav.library', icon: icon.library },
  { href: '/queue' as Route, label: 'nav.queue', icon: icon.queue },
];

/**
 * Settings, kept out of `navItems` on purpose.
 *
 * It is not a place to find something to listen to, so it does not belong in
 * the list of places that are. It is rendered separately in both the sidebar
 * and the tab bar — the latter because on a narrow viewport the sidebar is
 * hidden, and this is then the only route to signing in or out.
 */
export const settingsItem: NavItem = {
  href: '/settings' as Route,
  label: 'nav.settings',
  icon: icon.settings,
};
