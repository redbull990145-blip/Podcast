export { canAlign, shouldOfferAlignment } from './alignment.ts';
export type { AlignableTranscript } from './alignment.ts';

export {
  activeSegmentIndex,
  searchSegments,
  seekTargetSec,
  SEEK_LEAD_MS,
} from './active.ts';

export { gapBefore, GAP_MS, segmentWords, wordProgress } from './words.ts';
export type { TimedWord } from './words.ts';
