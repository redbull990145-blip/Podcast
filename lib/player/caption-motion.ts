/**
 * The maths behind the Apple-Music-style transcript.
 *
 * Kept out of the component because it is the part worth testing: the component
 * is refs and springs, but these are plain functions with exact answers, and
 * getting the karaoke fill wrong by a fraction is the difference between text
 * that tracks the voice and text that drifts ahead of it.
 */

import type { TranscriptSegment, TranscriptWord } from "@/lib/db/schema";

/** How a caption line looks at a given distance from the one being spoken. */
export type LineEmphasis = {
  opacity: number;
  scale: number;
  /** Blur radius in pixels. */
  blur: number;
};

/**
 * Emphasis by distance from the active line, nearest first; the last entry is
 * the floor for everything further away.
 *
 * Measured off Spotify's lyrics view rather than chosen by eye. Sampling the
 * same line while it was being sung and again once it had scrolled up one
 * place: peak brightness fell from 255 to 79 over a background of 38, which is
 * an effective opacity near 0.3; the steepest edge in the glyphs fell from 214
 * to 8, which for a step that size puts the blur at roughly two CSS pixels; and
 * the rendered line narrowed from 891px to 879px, a scale of 0.983.
 *
 * The surprise in those numbers is which one does the work. The scale barely
 * moves — under two percent — while the blur is heavy enough to make a
 * neighbouring line genuinely unreadable. That is the opposite of the usual
 * instinct to shrink the inactive rows, and it is why the effect reads as
 * depth-of-field on one sentence rather than as a list resizing itself. Scale
 * stays tiny for the same reason it always did: text is being actively read,
 * and a large scale change turns "this line matters" into "the layout moved".
 *
 * The table stops changing after three lines out, which means advancing one
 * line only re-animates the handful of rows whose values actually differ, not
 * every row on screen.
 */
const EMPHASIS: readonly LineEmphasis[] = [
  { opacity: 1, scale: 1, blur: 0 },
  { opacity: 0.3, scale: 0.983, blur: 2 },
  { opacity: 0.24, scale: 0.976, blur: 3.2 },
  { opacity: 0.2, scale: 0.972, blur: 4 },
];

/** The distance past which emphasis is constant. */
export const EMPHASIS_RANGE = EMPHASIS.length - 1;

/**
 * Look of a line `index` when `active` is being spoken.
 *
 * Symmetric: a line just read is dimmed exactly as much as one about to be.
 * Apple does the same, and the alternative — leaving spoken lines bright —
 * makes the eye drift backwards up the list.
 *
 * `active` of -1 means nothing is being spoken yet, in which case every line
 * sits at the floor rather than one arbitrarily lighting up.
 */
export function lineEmphasis(index: number, active: number): LineEmphasis {
  if (active < 0) return EMPHASIS[EMPHASIS_RANGE];
  const distance = Math.min(Math.abs(index - active), EMPHASIS_RANGE);
  return EMPHASIS[distance];
}

/**
 * One rendered word of a caption line, with where it sits and when it is said.
 *
 * `from`/`to` are positions in the line's *character* space, 0 to 1. They are
 * what lets each word paint its own fill: the line publishes a single progress
 * value and every word works out its own share of it, so the colour is confined
 * to the word being spoken instead of sweeping the sentence.
 */
export type CaptionWord = {
  text: string;
  from: number;
  to: number;
  start: number;
  end: number;
};

/**
 * Splitting a line into words is done once per segment and reused, because it
 * happens for every visible row and the answer never changes.
 */
const wordCache = new WeakMap<object, CaptionWord[]>();

/**
 * A word reduced to the letters and digits in it, for comparison.
 *
 * The provider's token and the rendered token are the same word said once, but
 * they rarely agree character for character: Whisper returns a leading space,
 * attaches punctuation to one side or the other, and normalises case
 * differently between the segment text and the word list. Devanagari adds its
 * own danda, which comes back as a token of its own about half the time.
 * Comparing on letters alone is what makes "Hai?" and " hai" the same word.
 */
function wordKey(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Whether two keys are plausibly the same spoken word, allowing for a provider
 * that split a contraction or clipped a suffix.
 *
 * Deliberately loose, and only ever consulted after an exact match has been
 * ruled out for the whole window — see `alignTimings`. On its own this rule is
 * not safe to take the first hit from: the three-character floor stops "a"
 * swallowing "and", but it does nothing about "the" swallowing "there", "our"
 * swallowing "ours", "her"/"here", "one"/"ones", "was"/"wasn't" or "for"/"form".
 * Those are common enough words that one of them appears in most paragraphs.
 */
function looksLikeSameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(short);
}

/**
 * How far ahead in the timing list to look for a rendered word.
 *
 * Bounded because the two lists are the same speech in the same order: a real
 * match is a token or two away, and anything further is a coincidence that
 * would drag the rest of the line out of alignment behind it.
 */
const ALIGN_LOOKAHEAD = 3;

/**
 * Pairs each rendered token with the provider timing for that word, or null.
 *
 * A single forward walk over both lists, so it can never pair a token with a
 * timing that comes before one already used — the failure that put the
 * highlight on a different word from the one being said. Tokens with no match
 * are left null for the caller to interpolate; a timing with no token is simply
 * skipped.
 *
 * ## Exact matches win the whole window before any fuzzy one is considered
 *
 * The window is scanned twice, and the order is the point. Taking the first
 * position that merely *looks* like a match is how a token acquires the timing
 * of a different word: with tokens `… the answer …` against timings
 * `… there, the, answer …`, "the" tests against "there" first,
 * `looksLikeSameWord` accepts it on the prefix rule, and the cursor advances
 * past the real "the". Every later word on the line inherits the shift, and
 * because the anchors are forced monotonic downstream the error cannot correct
 * itself — it reads as a run of words highlighting slightly early.
 *
 * The two lists are the same speech in the same order, so if the true match is
 * anywhere it is inside the window. Preferring it costs one extra pass over at
 * most four entries and removes the entire class of false anchor. The fuzzy
 * rule then does what it was actually for: catching a contraction or a clipped
 * suffix in the cases where nothing matched exactly.
 */
function alignTimings(
  tokens: string[],
  timings: readonly TranscriptWord[],
): (TranscriptWord | null)[] {
  const anchors: (TranscriptWord | null)[] = new Array(tokens.length).fill(null);

  const tokenKeys = tokens.map(wordKey);
  const timingKeys = timings.map((w) => wordKey(w.text));

  let next = 0;
  for (let i = 0; i < tokens.length && next < timings.length; i += 1) {
    const key = tokenKeys[i];
    // Punctuation on its own is rendered but never spoken.
    if (!key) continue;

    const limit = Math.min(timings.length, next + 1 + ALIGN_LOOKAHEAD);

    let match = -1;
    for (let j = next; j < limit; j += 1) {
      if (timingKeys[j] === key) {
        match = j;
        break;
      }
    }
    if (match === -1) {
      for (let j = next; j < limit; j += 1) {
        if (timingKeys[j] && looksLikeSameWord(key, timingKeys[j])) {
          match = j;
          break;
        }
      }
    }

    if (match !== -1) {
      anchors[i] = timings[match];
      next = match + 1;
    }
  }

  return anchors;
}

/**
 * The words of a line, positioned in character space and timed in seconds.
 *
 * Tokenising `segment.text` rather than trusting `segment.words` to be the
 * rendered text matters: the timings are what the provider heard, the text is
 * what is on screen, and they are not always the same list. Whisper drops or
 * merges the odd token, and a publisher transcript has no words at all. Since
 * the fill is painted onto the rendered text, the rendered text has to be what
 * defines the boxes — timings are then mapped onto it.
 *
 * Mapping is by text, not by position. Requiring the two lists to be the same
 * length was the earlier rule, and it failed in both directions: one extra
 * punctuation token threw away every real timing on the line and left the whole
 * sentence to a linear sweep, while a dropped word paired with an extra split
 * kept the count intact and silently shifted every timing onto the wrong word.
 * Aligning on the words themselves means a partial match still anchors the
 * words it does recognise, and a bad match is a gap rather than an error.
 *
 * Whatever is left unanchored borrows the time between its neighbours, shared
 * out by how long each word is. That is a guess, but a per-word one confined to
 * the run it covers, so the highlight keeps stepping word by word instead of
 * gliding across the sentence.
 */
export function captionWords(
  segment: Pick<TranscriptSegment, "start" | "end" | "text" | "words">,
): CaptionWord[] {
  const cached = wordCache.get(segment as object);
  if (cached) return cached;

  // Defensive: a line with no text has no words to light up, and a transcript
  // from an unfamiliar source should not be able to throw here.
  const tokens = (segment.text ?? "").split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  // A word's width is its own length plus the space that follows it, which is
  // how much of the rendered line it actually occupies.
  const widths = tokens.map((t) => t.length + 1);
  const totalWidth = widths.reduce((sum, n) => sum + n, 0);

  const timings = segment.words;
  const anchors =
    timings && timings.length > 0
      ? alignTimings(tokens, timings)
      : new Array<TranscriptWord | null>(tokens.length).fill(null);

  const starts = new Array<number>(tokens.length);
  const ends = new Array<number>(tokens.length);
  const anchored = new Array<boolean>(tokens.length).fill(false);

  // Anchors first, forced to run forwards. A provider timing that steps
  // backwards is rare but real, and left alone it makes the fill jump back up
  // the line mid-sentence.
  let floor = segment.start;
  for (let i = 0; i < tokens.length; i += 1) {
    const anchor = anchors[i];
    if (!anchor) continue;
    const start = Math.max(floor, anchor.start);
    starts[i] = start;
    ends[i] = Math.max(start, anchor.end);
    anchored[i] = true;
    floor = start;
  }

  // Then every unanchored run, sharing the time between the anchors on either
  // side of it. With no anchors at all this is one run across the whole line,
  // which is exactly the proportional fallback a publisher transcript gets.
  for (let i = 0; i < tokens.length; ) {
    if (anchored[i]) {
      i += 1;
      continue;
    }

    let j = i;
    while (j < tokens.length && !anchored[j]) j += 1;

    const from = i > 0 ? ends[i - 1] : segment.start;
    // A following anchor bounds the run; past the last one, the line's own end
    // does. `Math.max` keeps the span from going negative when a segment's end
    // arrives before its last word's timing.
    const to = j < tokens.length ? starts[j] : segment.end;
    const span = Math.max(0, to - from);

    let runWidth = 0;
    for (let k = i; k < j; k += 1) runWidth += widths[k];

    let elapsed = 0;
    for (let k = i; k < j; k += 1) {
      starts[k] = from + (elapsed / runWidth) * span;
      elapsed += widths[k];
      ends[k] = from + (elapsed / runWidth) * span;
    }

    i = j;
  }

  const words: CaptionWord[] = [];
  let charsSoFar = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    const from = charsSoFar / totalWidth;
    charsSoFar += widths[i];
    words.push({
      text: tokens[i],
      from,
      to: charsSoFar / totalWidth,
      start: starts[i],
      end: ends[i],
    });
  }

  wordCache.set(segment as object, words);
  return words;
}

/**
 * How much of a line has been spoken, 0 to 1, in the line's character space.
 *
 * The value is a position along the rendered text, not along the clock, because
 * that is what the paint needs: each word knows which slice of the line it
 * occupies and can turn one number into its own local fill.
 *
 * The walk holds the fill at the end of the last finished word until the next
 * one actually begins, so a pause freezes the colour where the speech stopped
 * rather than gliding on through the silence.
 */
export function fillFraction(
  segment: Pick<TranscriptSegment, "start" | "end" | "text" | "words">,
  currentTime: number,
): number {
  if (currentTime <= segment.start) return 0;

  const words = captionWords(segment);
  if (words.length === 0) return 1;

  let spoken = 0;
  for (const word of words) {
    // Not started: everything from here on is unspoken.
    if (currentTime < word.start) break;

    const wordSpan = word.end - word.start;
    const within = wordSpan > 0 ? (currentTime - word.start) / wordSpan : 1;

    if (within >= 1) {
      spoken = word.to;
      continue;
    }

    return clamp01(word.from + (word.to - word.from) * within);
  }

  return clamp01(spoken);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Which word the fill is currently passing through, for a fill of `fill`.
 *
 * -1 before the line has started, `words.length` once it is finished; in
 * between, the index of the one word that is part spoken and part not.
 *
 * This exists to keep the expensive paint down to a single word. Painting the
 * sweep means clipping a gradient to the glyphs, and `background-clip: text`
 * is one of the costliest things a browser can be asked to rasterise: it
 * builds a mask from the shaped text and composites the gradient through it,
 * every frame the gradient moves. Applying it to every word of the line meant
 * about twenty of those per frame, plus forty at a line change as one line
 * handed over to the next — measured at a 152ms stall on a 44px line, which is
 * eleven dropped frames right where the scroll begins.
 *
 * Only one word is ever mid-sweep. The ones behind it are flat spoken colour
 * and the ones ahead are flat unspoken colour, and a flat colour costs nothing.
 * So the clip is applied to that word alone and the rest are painted normally,
 * which looks identical and is twenty times less work.
 */
export function fillingWordIndex(words: readonly CaptionWord[], fill: number): number {
  if (fill <= 0) return -1;
  for (let i = 0; i < words.length; i += 1) {
    if (fill < words[i].to) return i;
  }
  return words.length;
}

/**
 * Where the spoken line sits in the viewport, as a fraction of its height.
 *
 * Above the middle, not on it. Locating the sung text in a frame-by-frame
 * capture of Spotify's lyrics puts it at 41% of the panel every time — a
 * single-row line parks there and a two-row line straddles it, so it is the
 * line's centre being anchored, not its top.
 *
 * The asymmetry is the point: it leaves half again as much room below the
 * current line as above it, so what is coming is always more legible than what
 * has gone. Centring gives equal weight to text nobody is going to read again,
 * and that is the difference between a transcript that leads and one that
 * trails.
 */
export const ACTIVE_LINE_ANCHOR = 0.41;

/**
 * Where the list has to sit for `index` to sit on the anchor, as a translateY.
 *
 * Negative, because the list moves up to bring later lines into view. Clamped
 * so the first and last lines can't be dragged into empty space — the same
 * bounds a scroll container would have enforced for free.
 */
export function centreOffset(
  tops: number[],
  total: number,
  index: number,
  viewportHeight: number,
  rowHeight: number,
  anchor: number = ACTIVE_LINE_ANCHOR,
): number {
  const top = tops[index] ?? 0;
  const ideal = top - viewportHeight * anchor + rowHeight / 2;
  const max = Math.max(0, total - viewportHeight);
  const scrollTop = Math.max(0, Math.min(ideal, max));
  // `-0` is a valid translateY but a nuisance to assert against and to compare
  // for equality against a freshly clamped 0.
  return scrollTop === 0 ? 0 : -scrollTop;
}

/** Clamps a translateY to the scrollable bounds. */
export function clampOffset(
  offset: number,
  total: number,
  viewportHeight: number,
): number {
  const max = Math.max(0, total - viewportHeight);
  const clamped = Math.max(-max, Math.min(0, offset));
  return clamped === 0 ? 0 : clamped;
}

/**
 * Whether `index` is on screen for a given translateY.
 *
 * Used to decide when following resumes: someone who drags back to the line
 * being spoken has said, without pressing anything, that they want to follow
 * along again.
 */
export function isRowVisible(
  tops: number[],
  index: number,
  offset: number,
  viewportHeight: number,
): boolean {
  const top = tops[index];
  if (top === undefined) return false;
  const scrollTop = -offset;
  return top >= scrollTop - 40 && top <= scrollTop + viewportHeight;
}
