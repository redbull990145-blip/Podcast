/**
 * Nav icons as inline SVG.
 *
 * No icon library. Three icons do not justify a dependency, and inline paths
 * mean no extra request, no font-loading flash, and no icon set whose visual
 * language quietly overrides the product's own.
 */
export function NavIcon({ path, filled }: { path: string; filled: boolean }) {
  return (
    <svg
      width="22"
      height="22"
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
