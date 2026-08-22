/**
 * TanStack Query keys.
 *
 * Centralised because cache invalidation is only correct if every caller
 * agrees on the key. Hierarchical by design: invalidating `['podcast', id]`
 * also invalidates `['podcast', id, 'episodes']`, so subscribing to a show
 * refreshes its episode list without anyone naming that list explicitly.
 */

export const queryKeys = {
  /** The current session. Invalidated on sign-in and sign-out. */
  session: ['session'] as const,

  library: {
    all: ['library'] as const,
    subscriptions: () => ['library', 'subscriptions'] as const,
    /** Whether one show is followed — read by the subscribe button. */
    isSubscribed: (podcastId: string) => ['library', 'subscribed', podcastId] as const,
    /**
     * Episodes in progress. Under `library` so signing out invalidates it with
     * everything else that belonged to the person who left.
     */
    continue: () => ['library', 'continue'] as const,
    recommendations: () => ['library', 'recommendations'] as const,
    history: () => ['library', 'history'] as const,
    stats: () => ['library', 'stats'] as const,
  },

  /**
   * The play queue. Flat rather than hierarchical: there is exactly one queue
   * per listener, and nothing hangs beneath it.
   */
  queue: ['queue'] as const,

  playlists: {
    all: ['playlists'] as const,
    /**
     * The whole list, or one kind of it.
     *
     * The kind is part of the key because the Library's two tabs are two
     * different server responses — sharing a key would let the shows tab render
     * whatever the episodes tab fetched last.
     */
    list: (kind?: 'episode' | 'podcast') =>
      kind ? (['playlists', 'list', kind] as const) : (['playlists', 'list'] as const),
    detail: (id: string) => ['playlists', id] as const,
    /**
     * Which playlists hold a given episode.
     *
     * Under `playlists` rather than under the episode, because adding to one
     * invalidates *this* answer for every episode — and invalidating
     * `['playlists']` after any change is then correct without anyone naming
     * the membership queries individually.
     */
    containing: (episodeId: string) => ['playlists', 'containing', episodeId] as const,
    /** The same question for a whole show. */
    containingPodcast: (podcastId: string) =>
      ['playlists', 'containing-podcast', podcastId] as const,
  },

  podcast: {
    all: ['podcast'] as const,
    list: () => ['podcast', 'list'] as const,
    detail: (id: string) => ['podcast', id] as const,
    episodes: (id: string) => ['podcast', id, 'episodes'] as const,
  },
  episode: {
    all: ['episode'] as const,
    detail: (id: string) => ['episode', id] as const,
    /** Under the episode, so invalidating one drops its transcript too. */
    transcript: (id: string) => ['episode', id, 'transcript'] as const,
    /** The artwork's dominant colour. Effectively immutable once extracted. */
    tint: (id: string) => ['episode', id, 'tint'] as const,
    /**
     * Generated artefacts, keyed by language as well — the same episode
     * summarised in another language is a different answer, not a translation
     * of this one.
     */
    ai: (id: string, language = 'en') => ['episode', id, 'ai', language] as const,
  },

  /** The caller's AI allowance, and whose key is funding it. */
  ai: {
    quota: () => ['ai', 'quota'] as const,
  },
  discover: {
    all: ['discover'] as const,
    /**
     * The query is part of the key, so two searches never share a cache entry —
     * and going back to a previous term shows its results instantly.
     */
    search: (query: string, language?: string) =>
      ['discover', 'search', query.trim().toLowerCase(), language ?? 'any'] as const,
    trending: (language?: string) => ['discover', 'trending', language ?? 'any'] as const,
    categories: () => ['discover', 'categories'] as const,
    inCategory: (slug: string) => ['discover', 'category', slug] as const,
  },
} as const;

/**
 * How long each kind of data stays fresh.
 *
 * The brief's rule — don't refetch unnecessarily — comes down to these
 * numbers. A podcast's metadata changes when the publisher edits it, which is
 * rarely; a search result for the same term is stable for far longer than a
 * user will sit on the screen.
 */
export const staleTime = {
  /** Show metadata: title, artwork, description. */
  podcast: 15 * 60 * 1000,
  /** Episode lists: a new episode appears at most a few times a week. */
  episodes: 5 * 60 * 1000,
  /** Search: the same term gives the same answer for a long while. */
  search: 30 * 60 * 1000,
  trending: 15 * 60 * 1000,
  /** Categories move when a show is ingested, which is rarely and never urgently. */
  categories: 30 * 60 * 1000,
  /**
   * Recommendations: a rail, not a readout.
   *
   * The server already caches the computed answer for ten minutes, so a
   * shorter client stale time would only buy round trips that return the same
   * list. Matching it means Home re-uses what it has for as long as the answer
   * could not have changed anyway.
   */
  recommendations: 10 * 60 * 1000,
} as const;
