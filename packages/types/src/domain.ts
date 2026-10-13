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
  /**
   * How the show got into the catalogue: curated by the operator, or pulled in
   * from the directory by someone's search.
   *
   * The catalogue is shared, so a search result becomes a row everyone can see.
   * This is what lets the clients treat the two differently without pretending
   * the second kind does not exist.
   */
  source: 'seed' | 'directory';
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
  /**
   * Dominant colour of this episode's own art, as `#RRGGBB`.
   *
   * Null until the episode has been played once — it is extracted on demand
   * rather than for every episode of every feed. Callers fall back to the
   * show's colour, which is why null here is a normal state and not an error.
   */
  accentColor: string | null;
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

/**
 * A browsable slice of the catalogue.
 *
 * `accentColour` is borrowed from one of the shows inside it rather than
 * assigned. The product's rule is that colour arrives from content, and a
 * category has no artwork of its own — so it wears the colour of a show that
 * belongs to it, which means the palette of the browse screen is whatever the
 * catalogue actually contains rather than a set of hues someone picked.
 */
export type Category = {
  slug: string;
  name: string;
  /** How many shows in the catalogue carry it. Never zero — empty ones are dropped. */
  count: number;
  accentColor: string | null;
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

/** One word of a cue, with the span the transcriber measured for it. */
export type TranscriptWord = { startMs: number; endMs: number; text: string };

export type TranscriptSegment = {
  /** Position within the transcript, 0-based. */
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  /** Speaker label where the source provides one. */
  speaker: string | null;
  /**
   * Measured per-word timings, where they exist.
   *
   * Absent or null for publisher caption files, which are cue-level by format,
   * and for transcripts generated before word timings were requested. The
   * player estimates word spans from the cue in that case — well enough to read
   * along with, but an estimate. This is the real thing when it is here.
   */
  words?: TranscriptWord[] | null;
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
  /**
   * How long the audio these cues were timed against actually ran, in ms.
   *
   * The reason captions drift. Podcast enclosures are stitched per request, so
   * the copy the server transcribed and the copy a listener is served are
   * routinely different lengths — different ad loads, inserted in different
   * places. On one measured episode the feed declared 2416s, the browser was
   * served 2596s, and the transcribed copy ran 2622s, which put every cue after
   * the first ad break about 26 seconds out, by a different amount per listener.
   *
   * The measurement has been stored against the transcript for a while and read
   * by nothing, which meant the app had the evidence that its captions were
   * describing a different cut of the audio and no way to say so. Carrying it to
   * the client is what lets the player compare it against the duration it is
   * actually playing and offer to correct the difference.
   *
   * Null when nothing was measured: transcripts written before this was
   * recorded, audio that is not constant-bitrate MP3, and feeds that declare no
   * enclosure length. Null means "unknown", never "they match".
   */
  audioDurationMs: number | null;
  /**
   * Whether the timings below have already been corrected onto the served audio.
   *
   * When true the cues are no longer the publisher's own numbers: samples of the
   * real file were located in the transcript and every cue shifted onto the
   * timeline a listener actually hears. The manual nudge stays available, because
   * the correction was derived from *this server's* copy and ad stitching is per
   * request — but it is a nudge over a second or two rather than over the nine
   * that were there before.
   */
  aligned: boolean;
  /**
   * The length of the copy that correction was measured against, in ms.
   *
   * Carried so the player can tell whether it is playing that same copy. When
   * its own duration disagrees with this, the alignment was computed from a
   * different ad load and some residual drift is expected — which is exactly
   * when the nudge is worth offering. Null when nothing has been aligned.
   */
  alignedAgainstDurationMs: number | null;
  segments: TranscriptSegment[];
};

/** One tread of a correction: from `fromTranscriptMs` onward, add `offsetMs`. */
export type TranscriptOffsetStep = {
  fromTranscriptMs: number;
  offsetMs: number;
  /** The window the insertion is known to lie within, in publisher time. */
  bracketMs: [number, number];
};

/**
 * A stored correction from publisher time onto served-audio time.
 *
 * Kept beside the cues rather than baked into them, so the publisher's own
 * numbers survive: a correction that turns out to be wrong can be dropped
 * without re-fetching anything, and a better one can replace it.
 */
export type TranscriptAlignment = {
  steps: TranscriptOffsetStep[];
  anchors: { audioMs: number; transcriptMs: number; similarity: number }[];
  /** Mean match quality of the samples it was fitted to, 0..1. */
  confidence: number;
  /** How many audio samples were transcribed to reach it. */
  probes: number;
  /** Duration of the copy it was measured against. */
  audioDurationMs: number;
  at: string;
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

/**
 * One episode's progress, as a *list* needs it.
 *
 * `StoredProgress` minus `deviceId`. That field exists to resolve the case
 * where two devices raced on the write path, and it has nothing to say to a row
 * on a show page — sent for every episode of an archive it is a hundred copies
 * of an answer to a question nobody asked.
 *
 * A named type rather than an inline `Pick` because both ends have to agree: it
 * is what `GET /me/progress` returns and what `<ListeningMark>` consumes, and a
 * shape spelled out twice is a shape that eventually differs.
 */
export type EpisodeProgress = Pick<
  StoredProgress,
  'episodeId' | 'positionSec' | 'durationSec' | 'completed' | 'updatedAt'
>;

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

/**
 * An episode that was played, finished or not.
 *
 * A continue entry plus the one fact continue does not need: whether it
 * reached the end. "Recently played" is the only surface where a finished
 * episode is the *point* rather than something to filter out, and without this
 * flag a row saying "12 min left" is indistinguishable from one that should
 * say "Finished".
 */
export type HistoryEntry = ContinueEntry & {
  completed: boolean;
};

/**
 * What a listener has done, as Home's masthead reports it.
 *
 * `listenedSec` is the sum of how far into each episode they have reached, not
 * a measured play time — nothing in the app counts seconds of audio. It
 * over-counts skipping and under-counts replays. Close enough to show, wrong
 * to call a play log.
 *
 * `topCategories` is ordered by time and deliberately does not sum to
 * `listenedSec`: a show carrying three categories contributes its time to all
 * three, and any rule for splitting it would be a guess dressed as arithmetic.
 */
export type ListeningStats = {
  listenedSec: number;
  episodesStarted: number;
  episodesFinished: number;
  /** Distinct shows touched. */
  showCount: number;
  topShow: {
    id: PodcastId;
    title: string;
    author: string | null;
    artworkUrl: string | null;
    listenedSec: number;
  } | null;
  topCategories: Array<{ name: string; listenedSec: number }>;
};

/**
 * Why a show was recommended, in the ranker's own terms.
 *
 * `kind` is what matched, `subject` is the thing that matched — a category
 * name, a creator's name — and either may be absent, because plenty of shows
 * are recommended on catalogue quality alone and saying so is more honest than
 * inventing a connection.
 *
 * Two fields rather than a finished sentence, because the sentence has to be
 * written in the reader's language and the server does not know it. The
 * clients hold the phrasing; this holds the fact.
 */
export type RecommendationReason = {
  kind: 'category' | 'creator' | 'popular';
  subject: string | null;
};

/**
 * A recommended show, carrying its own justification.
 *
 * A rail of covers with no explanation is indistinguishable from a rail of
 * random covers, which is exactly the complaint that started this — so the
 * reason travels with the show rather than being reconstructed client-side
 * from data the client does not have.
 */
export type RecommendedPodcast = Podcast & {
  reason: RecommendationReason;
};

// ------------------------------------------------------------- playlists --

export type PlaylistId = string;

/**
 * What a playlist holds: an ordered listening session, or a shelf of shows.
 *
 * Fixed when the playlist is created. The two are different objects with
 * different verbs — one plays, the other is browsed — and a list that held both
 * would have a play-all button that could only play half of itself.
 */
export type PlaylistKind = 'episode' | 'podcast';

/** One of the six palette ids in `@cue/design`. Never a raw colour. */
export type PlaylistColor = 'ember' | 'ocean' | 'moss' | 'plum' | 'dusk' | 'sand';

/**
 * How a playlist's banner is drawn.
 *
 * `color` is the palette entry plus whatever line was written over it; `image`
 * is a picture the owner uploaded. Both carry `text`, because someone who
 * uploads a photo still often wants a word on it — and because switching
 * between the two must not silently throw the caption away.
 */
export type PlaylistBanner = {
  kind: 'color' | 'image';
  /** The palette id. Present whichever kind is showing, so switching back is free. */
  color: PlaylistColor;
  /**
   * The uploaded banner, if one was ever uploaded.
   *
   * Non-null while a picture exists even when `kind` is `color` — that is what
   * makes trying a colour and changing your mind a reversible act rather than a
   * reason to go and find the file again.
   */
  imageUrl: string | null;
  /** The line set across the banner. Null when there is none. */
  text: string | null;
};

/**
 * A playlist, as a list of them renders it.
 *
 * Private to its owner: there is no visibility, no author, and no share URL,
 * because none of those exist yet. A queue answers "what next"; this answers
 * "what for".
 */
export type Playlist = {
  id: PlaylistId;
  kind: PlaylistKind;
  title: string;
  description: string | null;
  /**
   * How many things are in it — episodes or shows, according to `kind`.
   *
   * One field rather than two, because no playlist has both and a caller that
   * had to pick between `episodeCount` and `podcastCount` would be re-deriving
   * `kind` at every call site.
   */
  itemCount: number;
  banner: PlaylistBanner;
  /**
   * The page wash for this playlist's own screen, or null to leave it alone.
   *
   * Separate from the banner colour: tinting a whole screen is a stronger
   * appetite than colouring a card, and most people only want the second.
   */
  backgroundColor: PlaylistColor | null;
  /**
   * Covers of the first few items, in playlist order, for a stacked tile.
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

/**
 * One show in a podcast playlist.
 *
 * A plain `Podcast`, because a show needs nothing attached to render — it is
 * already the whole object, where an episode is a fragment of one.
 */
export type PlaylistPodcastEntry = { podcast: Podcast };

/**
 * A playlist with its contents.
 *
 * The two item lists are separate fields rather than one polymorphic array, so
 * a component that renders episodes never has to prove at runtime that it was
 * not handed a show. Exactly one of them is ever non-empty, decided by `kind`.
 */
export type PlaylistDetail = Playlist & {
  items: PlaylistEntry[];
  podcasts: PlaylistPodcastEntry[];
};
