/**
 * Domain entities.
 *
 * These are the shapes that cross the wire, shared verbatim by the API, the
 * web app and the Android app. Two rules keep them honest:
 *
 *  1. **Times are numbers, not Dates.** JSON has no Date, and a type that
 *     claims `Date` after `JSON.parse` is lying. Instants are ISO-8601
 *     strings; positions and durations are numbers with the unit in the name.
 *  2. **Units are in the identifier.** `durationSec`, `startMs`. Audio code
 *     mixes seconds and milliseconds constantly and the resulting bugs are
 *     invisible until something is 1000× off.
 */

/** ISO-8601 instant, e.g. `2026-08-13T09:41:00.000Z`. */
export type IsoDateTime = string;

/** BCP-47 language tag, e.g. `en`, `hi`, `pt-BR`. */
export type LanguageTag = string;

export type PodcastId = string;
export type EpisodeId = string;
export type UserId = string;

// ---------------------------------------------------------------- catalog --

export type Podcast = {
  id: PodcastId;
  /** Canonical RSS URL. Unique across the catalog; the identity of a show. */
  feedUrl: string;
  title: string;
  /** Publisher/author as given by the feed. */
  author: string | null;
  description: string | null;
  artworkUrl: string | null;
  /** Publisher's own site, not the feed. */
  websiteUrl: string | null;
  language: LanguageTag | null;
  categories: string[];
  explicit: boolean;
  /** Null until we have ingested the feed at least once. */
  episodeCount: number | null;
  lastPublishedAt: IsoDateTime | null;
  /**
   * Dominant colour of the artwork as `#RRGGBB`, or null for a cover with no
   * usable hue. Clients pass it through `deriveTint` rather than using it
   * directly — a raw cover colour is as likely to be fluorescent as not.
   */
  accentColor: string | null;
};

export type Episode = {
  id: EpisodeId;
  podcastId: PodcastId;
  /** Publisher's `<guid>`. Unique within a podcast, not globally. */
  guid: string;
  title: string;
  /** Plain-text summary. HTML show notes live in `descriptionHtml`. */
  description: string | null;
  descriptionHtml: string | null;
  /** Direct URL to the publisher's audio. We never proxy or store this. */
  audioUrl: string;
  /**
   * Null is common and legitimate — plenty of feeds omit duration. The player
   * discovers the real duration on load, so UI must handle null rather than
   * defaulting to 0 and rendering a broken scrubber.
   */
  durationSec: number | null;
  publishedAt: IsoDateTime;
  /** Episode-specific art; falls back to the podcast's. */
  artworkUrl: string | null;
  episodeNumber: number | null;
  seasonNumber: number | null;
  explicit: boolean;
  /** Publisher-provided transcript, if the feed declares one. */
  transcriptUrl: string | null;
};

/** An episode with enough of its show attached to render a row standalone. */
export type EpisodeWithPodcast = Episode & {
  podcast: Pick<Podcast, 'id' | 'title' | 'artworkUrl' | 'author'>;
};

/**
 * A search hit.
 *
 * Deliberately *not* a `Podcast`: these come from the upstream directory and
 * are not in our database, so they have no id. The feed URL is the identity
 * until someone subscribes, which is what ingests the show and gives it one.
 * Typing these as `Podcast` with a fake id is how a UI ends up linking to a
 * detail page that 404s.
 */
export type PodcastSearchResult = {
  feedUrl: string;
  title: string;
  author: string | null;
  description: string | null;
  artworkUrl: string | null;
  language: LanguageTag | null;
  categories: string[];
  explicit: boolean;
  episodeCount: number | null;
  lastPublishedAt: IsoDateTime | null;
};

// ------------------------------------------------------------ user state --

export type Subscription = {
  podcastId: PodcastId;
  subscribedAt: IsoDateTime;
  /** Per-show override of the global new-episode notification setting. */
  notifyOnNew: boolean;
};

export type PlaybackProgress = {
  episodeId: EpisodeId;
  positionSec: number;
  /** Duration as observed by the client that wrote this. */
  durationSec: number | null;
  completed: boolean;
  updatedAt: IsoDateTime;
  /**
   * Which device wrote this. Used to resolve the "two devices raced" case
   * without rewinding whichever one was genuinely further ahead.
   */
  deviceId: string;
};

export type QueueItem = {
  episodeId: EpisodeId;
  /**
   * Fractional index. Reordering writes one row instead of renumbering the
   * whole queue, which is what keeps drag-to-reorder instant on a long queue.
   */
  sortKey: string;
  addedAt: IsoDateTime;
};

/**
 * A change to the queue, as the player reports it.
 *
 * Deliberately *what changed* rather than the resulting order: adding an
 * episode creates a row and reordering rewrites sort keys, and those are
 * different operations against storage. A shape that only carried the new
 * order would leave every caller diffing two lists to work out which one to
 * perform.
 *
 * It lives here rather than with the player because both the domain layer that
 * emits it and the transport layer that applies it need it, and this is the
 * package they already share.
 */
export type QueueMutation =
  | { type: 'add'; episodeId: EpisodeId; playNext: boolean }
  | { type: 'remove'; episodeId: EpisodeId }
  | { type: 'reorder'; episodeIds: EpisodeId[] }
  | { type: 'clear' };

// ------------------------------------------------------------ transcripts --

export type TranscriptSource = 'feed' | 'generated';
export type TranscriptStatus = 'pending' | 'processing' | 'ready' | 'failed';

export type TranscriptSegment = {
  /** Position within the transcript, 0-based. */
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  /** Speaker label where the source provides one. */
  speaker: string | null;
};

export type Transcript = {
  episodeId: EpisodeId;
  source: TranscriptSource;
  status: TranscriptStatus;
  language: LanguageTag;
  /**
   * Whether the segments carry real timecodes.
   *
   * False for the HTML transcripts publishers overwhelmingly ship, which are
   * prose with speaker labels and no timings. Those can be read but cannot
   * follow the audio, and the distinction has to survive to the client — a
   * transcript that silently stops highlighting looks broken, where one that
   * never offered to looks finished.
   */
  timed: boolean;
  segments: TranscriptSegment[];
};

export type Chapter = {
  startMs: number;
  endMs: number | null;
  title: string;
  imageUrl: string | null;
  url: string | null;
};

// -------------------------------------------------------------------- ai --

/** What was generated. Cached per episode, so one person's request serves all. */
export type AiKind = 'summary' | 'takeaways' | 'chapters';

/**
 * A generated artefact.
 *
 * `content` is narrowed by `kind` at the point of use rather than in the type,
 * because these travel together through one cache and one endpoint, and a
 * discriminated union here would force every caller to switch on a kind they
 * already asked for by name.
 */
export type EpisodeAi = {
  episodeId: EpisodeId;
  kind: AiKind;
  language: LanguageTag;
  /** Prose for `summary`, `string[]` for `takeaways`, `Chapter[]` for `chapters`. */
  content: unknown;
  /** Which model wrote it, so a bad answer can be traced to its author. */
  model: string;
  createdAt: IsoDateTime;
};

/**
 * Where an episode's transcript stands, and therefore what AI can be asked of
 * it.
 *
 * Distinct from `Transcript` because the answer is often "there isn't one yet,
 * and here is whether that can be fixed". A publisher transcript is free and
 * instant; generating one costs a Whisper run, so the UI has to be able to
 * offer that as a choice rather than silently spending someone's quota.
 */
export type TranscriptAvailability = {
  /** Whether any transcript exists, from the publisher or from us. */
  present: boolean;
  source: TranscriptSource | null;
  status: TranscriptStatus | null;
  /** Whether it carries timecodes, which is what chapters and follow-along need. */
  timed: boolean;
};

/**
 * The state of a user's AI allowance.
 *
 * `byok` means their own key is paying, and `remaining` is then meaningless —
 * we do not meter someone else's spend.
 */
export type AiQuota = {
  byok: boolean;
  /** Last four characters of their saved key, when they have one. */
  hint: string | null;
  used: number;
  limit: number;
  remaining: number;
  /** Whether an operator key exists at all. Without one, BYOK is the only path. */
  operatorAvailable: boolean;
};

/** One grounded citation: which transcript line an answer leaned on. */
export type AskCitation = {
  segmentIndex: number;
  startMs: number;
  text: string;
};

// ------------------------------------------------------------------ user --

export type Profile = {
  id: UserId;
  displayName: string | null;
  avatarUrl: string | null;
  /** Drives UI language and language-aware discovery. */
  locale: LanguageTag;
  createdAt: IsoDateTime;
};

/** The signed-in user, as every client sees them. */
export type SessionUser = {
  id: UserId;
  email: string;
  name: string;
  image: string | null;
};

/**
 * A show in your library.
 *
 * Carries your relationship to it, not just the show's own facts — the Library
 * is organised by what you have and haven't heard, so those numbers belong on
 * the wire rather than being derived per row in the client.
 */
export type LibraryPodcast = Podcast & {
  subscribedAt: IsoDateTime;
  /** Episodes published since you subscribed. */
  newEpisodeCount: number;
};

/** A stored playback position, as the server resolved it. */
export type StoredProgress = {
  episodeId: EpisodeId;
  positionSec: number;
  durationSec: number | null;
  completed: boolean;
  deviceId: string;
  updatedAt: IsoDateTime;
};

/** An episode in the queue, carrying enough of its show to render standalone. */
export type QueueEntry = {
  episode: Episode;
  podcastTitle: string;
  podcastArtworkUrl: string | null;
  accentColor: string | null;
};

/**
 * An episode part-way through.
 *
 * The same payload as a queue entry plus where you got to, because both are
 * rendered as "an episode with enough of its show to stand alone" and the
 * difference is only what the row says underneath.
 */
export type ContinueEntry = QueueEntry & {
  positionSec: number;
  durationSec: number | null;
  updatedAt: IsoDateTime;
};

// ------------------------------------------------------------- playlists --

export type PlaylistId = string;

/**
 * A playlist, as a list of them renders it.
 *
 * Private to its owner: there is no visibility, no author, and no share URL,
 * because none of those exist yet. A queue answers "what next"; this answers
 * "what for".
 */
export type Playlist = {
  id: PlaylistId;
  title: string;
  description: string | null;
  episodeCount: number;
  /**
   * Covers of the first few episodes, in playlist order, for a stacked tile.
   *
   * On the wire rather than derived per row in the client, because deriving it
   * means either fetching every playlist's contents to draw a list of names, or
   * drawing a list of names. Empty for a playlist nobody has filled yet.
   */
  artworkUrls: string[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
};

/**
 * One episode in a playlist.
 *
 * Identical to a queue entry, and deliberately so — both are "an episode with
 * enough of its show attached to render standalone", both feed the same row
 * component, and both are handed to the same player.
 */
export type PlaylistEntry = QueueEntry;

/** A playlist with its contents. */
export type PlaylistDetail = Playlist & {
  items: PlaylistEntry[];
};
