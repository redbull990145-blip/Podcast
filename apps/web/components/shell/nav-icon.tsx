/**
 * Nav icons as inline SVG.
 *
 * No icon library. Three icons do not justify a dependency, and inline paths
 * mean no extra request, no font-loading flash, and no icon set whose visual
 * language quietly overrides the product's own.
 */
export function NavIcon({
  path,
  filled,
  size = 22,
}: {
  path: string;
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
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.7}
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
