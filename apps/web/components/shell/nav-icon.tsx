/**
 * Nav icons as inline SVG.
 *
 * No icon library. Five icons do not justify a dependency, and inline paths
 * mean no extra request, no font-loading flash, and no icon set whose visual
 * language quietly overrides the product's own.
 *
 * They are all *line* icons, and that is a constraint rather than a
 * coincidence — see the fill note below for what happened when the active
 * state forgot it.
 */
export function NavIcon({
  path,
  filled,
  size = 22,
}: {
  path: string;
  /**
   * Whether this is the page you are on. Renders as extra stroke weight, not
   * as a fill — see below.
   */
  filled: boolean;
  /**
   * 22 in the tab bar, where the icon carries the row; 16 in the rail, where
   * it sits beside a label and only has to be recognisable. An icon drawn at
   * the same size in both reads as oversized in one of them.
   */
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      /*
        Always stroked, never filled.

        The active state used to swap to `fill="currentColor"` with a zero
        stroke, which works only for icons that happen to be closed shapes.
        Two of the five are not. Search is a circle plus a separate handle
        stroke, so filling it produced a solid orange disc with no handle —
        the "Search" row in the sidebar was marked by a dot. Queue and
        Settings are bare horizontal lines with no interior at all, so filling
        them erased the icon completely: the row you were on was the one with
        no icon.

        Weight is the cue that works for every path shape, and it composes with
        the colour and the ground the active row now carries rather than
        replacing them.
      */
      fill="none"
      stroke="currentColor"
      strokeWidth={filled ? 2.2 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      // Decorative: the accessible name lives on the link's text.
      focusable="false"
    >
      <path d={path} />
    </svg>
  );
}
