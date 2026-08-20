export {
  DEFAULT_PREFERENCES,
  normalizePreferences,
  normalizeRate,
  PLAYBACK_RATES,
  RATE_MAX,
  RATE_MIN,
  RATE_STEP,
  SKIP_BACK_OPTIONS,
  SKIP_BACK_SEC,
  SKIP_FORWARD_OPTIONS,
  SKIP_FORWARD_SEC,
} from './engine.ts';
export type {
  EngineEvent,
  EngineListener,
  PlaybackEngine,
  PlaybackPreferences,
  PlaybackRate,
  PlaybackStatus,
} from './engine.ts';

export { CAPTION_LEAD_MS, PlaybackClock } from './clock.ts';

export { PlayerMachine } from './machine.ts';
export type { MachineOptions, PlayableEpisode, PlayerListener, PlayerState } from './machine.ts';

export { playableFromEpisode, playableFromQueueEntry } from './playable.ts';

export {
  COMPLETION_THRESHOLD_SEC,
  CONCURRENT_WINDOW_MS,
  isComplete,
  reconcileProgress,
  RESUME_REWIND_SEC,
  resumePosition,
} from './resume.ts';
export type { ProgressRecord, Reconciliation } from './resume.ts';

export { generateKey, generateKeys } from './sort-key.ts';

export { describeStreamError, eventsFromStatus, initialStatusMemory } from './status.ts';
export type { StatusMemory, StatusSnapshot } from './status.ts';
