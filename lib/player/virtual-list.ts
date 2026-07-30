/**
 * Windowing maths for the transcript.
 *
 * Keeping every caption line in the DOM turned out to be the real cost of the
 * captions view: on a 2,855-line episode a single `scrollTop` write measured
 * 11ms, because the browser re-evaluates a 111,000px scroller full of elements.
 * An animation that writes scroll position every frame therefore cannot fit in
 * a frame budget, no matter how little React does.
 *
 * The fix is to render only what is on screen. Row heights vary (captions wrap),
 * so they are measured once — the transcript never changes after it loads — and
 * every position afterwards comes from that table.
 */

export type RowMetrics = {
  /** Top edge of each row, in pixels from the top of the list. */
  tops: number[];
  /** Total scrollable height. */
  total: number;
};

/** Builds the position table from measured row heights. */
export function measureRows(heights: number[], gap = 0): RowMetrics {
  const tops = new Array<number>(heights.length);
  let offset = 0;

  for (let i = 0; i < heights.length; i += 1) {
    tops[i] = offset;
    offset += heights[i] + gap;
  }

  return { tops, total: offset > 0 ? offset - gap : 0 };
}

/**
 * Index of the last row starting at or before `y`.
 *
 * Binary search rather than a scan: this runs on every scroll frame, and a
 * linear walk over a few thousand rows there would reintroduce the cost the
 * windowing is meant to remove.
 */
export function rowAt(tops: number[], y: number): number {
  if (tops.length === 0) return 0;

  let low = 0;
  let high = tops.length - 1;

  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (tops[mid] <= y) low = mid;
    else high = mid - 1;
  }

  return low;
}

/**
 * The slice to render for a given scroll position.
 *
 * `overscan` rows are kept either side so a fast flick does not outrun the
 * render and expose blank space.
 */
export function visibleRange(
  metrics: RowMetrics,
  scrollTop: number,
  viewportHeight: number,
  overscan = 6,
): { start: number; end: number } {
  const { tops } = metrics;
  if (tops.length === 0) return { start: 0, end: 0 };

  const first = rowAt(tops, scrollTop);
  const last = rowAt(tops, scrollTop + viewportHeight);

  return {
    start: Math.max(0, first - overscan),
    // `end` is exclusive.
    end: Math.min(tops.length, last + overscan + 1),
  };
}

/** Scroll position that centres a row in the viewport, clamped to the list. */
export function centreOn(
  metrics: RowMetrics,
  index: number,
  viewportHeight: number,
  rowHeight: number,
): number {
  const top = metrics.tops[index] ?? 0;
  const target = top - viewportHeight / 2 + rowHeight / 2;
  return Math.max(0, Math.min(target, Math.max(0, metrics.total - viewportHeight)));
}
