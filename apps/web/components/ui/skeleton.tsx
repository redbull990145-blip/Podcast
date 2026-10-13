/**
 * Held space, while something is on its way.
 *
 * The app already had skeletons and they were good ones — sized to the real
 * content so nothing moves when it lands. What it did not have was *one* of
 * them: five screens each hand-rolled `bg-[var(--color-skeleton)]` with their
 * own radius and their own idea of how tall a line of text is, and three more
 * gave up and rendered the word "Loading…". So the same wait looked like three
 * different kinds of event depending on which screen you were on.
 *
 * A skeleton beats a spinner here for a reason that is specific to this app
 * rather than general: nearly everything that loads is a *list of rows with
 * artwork*, whose shape is known before the data is. A spinner throws that away
 * and then shifts the page when it resolves.
 *
 * Deliberately not animated. A shimmer is a gradient moving under a mask on
 * every skeleton on screen at once, which is real paint cost during the one
 * moment the main thread is already busy parsing a response — and this app
 * holds a 320ms ceiling on motion precisely so that nothing loops for longer
 * than it takes to read. Held space that is simply *there* says "this is coming"
 * as clearly, and costs nothing.
 */
export function Skeleton({
  w,
  h,
  shape = 'line',
  className,
}: {
  /** Width. A number is px; a string is any CSS length or percentage. */
  w?: number | string;
  h?: number | string;
  /**
   * `line` for text, `block` for artwork and cards, `pill` for a control.
   *
   * The radius follows the thing being stood in for rather than being passed
   * per call site, which is what kept the hand-rolled ones from agreeing.
   */
  shape?: 'line' | 'block' | 'pill';
  className?: string;
}) {
  const radius =
    shape === 'pill'
      ? 'var(--radius-full)'
      : shape === 'block'
        ? 'var(--radius-md)'
        : 'var(--radius-xs)';

  return (
    <span
      aria-hidden="true"
      className={['block shrink-0 bg-[var(--color-skeleton)]', className ?? '']
        .filter(Boolean)
        .join(' ')}
      style={{ width: w, height: h, borderRadius: radius }}
    />
  );
}
