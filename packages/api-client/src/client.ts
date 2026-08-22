/**
 * The typed API client, shared by web and Android.
 *
 * Built on `fetch` with no HTTP library, because both platforms already have
 * one and a wrapper would be a dependency for no capability. It knows nothing
 * about React — TanStack Query composes these functions; it does not own them.
 * That keeps the same calls usable from a service worker, a background sync
 * task, or a test.
 */

import type {
  AiQuota,
  ApiError,
  ApiResult,
  AskCitation,
  Category,
  Chapter,
  ContinueEntry,
  Cursor,
  Episode,
  HistoryEntry,
  LibraryPodcast,
  ListeningStats,
  NumberedPage,
  Page,
  Playlist,
  PlaylistColor,
  PlaylistDetail,
  PlaylistKind,
  Podcast,
  PodcastSearchResult,
  QueueEntry,
  QueueMutation,
  RecommendedPodcast,
  SessionUser,
  StoredProgress,
  Transcript,
} from '@cue/types';
import { fetchSse, type SseTransport } from './sse.ts';

/**
 * A failed request, carrying the machine-readable code.
 *
 * Callers switch on `code` — never on the message, which is written for people
 * and changes freely.
 */
export class ApiClientError extends Error {
  readonly code: ApiError['code'];
  readonly fields: Record<string, string> | undefined;
  readonly retryAfterSec: number | undefined;
  readonly status: number;
  /**
   * Better Auth's own error code, on the auth endpoints only.
   *
   * Kept separate from `code` because it comes from a different vocabulary —
   * this API's codes are a closed union, Better Auth's are its own strings.
   * Carrying it matters for the ones that are a *state* rather than a mistake:
   * `EMAIL_NOT_VERIFIED` means the password was right and the address is not
   * confirmed yet, which the UI answers by asking for a code rather than by
   * reporting a failure. Matching that on the human-readable message instead
   * would break the first time the wording changed.
   */
  readonly authCode: string | undefined;

  constructor(error: ApiError & { authCode?: string }, status: number) {
    super(error.message);
    this.name = 'ApiClientError';
    this.code = error.code;
    this.fields = error.fields;
    this.retryAfterSec = error.retryAfterSec;
    this.status = status;
    this.authCode = error.authCode;
  }

  /**
   * Whether retrying could plausibly succeed. TanStack Query reads this to
   * decide whether to back off or give up — retrying a 404 is just latency.
   */
  get retryable(): boolean {
    return this.code === 'rate_limited' || this.code === 'upstream_unavailable';
  }
}

/**
 * Detect an aborted request across runtimes.
 *
 * Every implementation sets `name === 'AbortError'`; not every runtime exposes
 * `DOMException` as a global to test against.
 */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

export type ClientOptions = {
  /** Base URL of the API, no trailing slash. */
  baseUrl: string;
  /** Injected on native, where cookies are not the session transport. */
  getAuthToken?: () => string | null | Promise<string | null>;
  fetchImpl?: typeof fetch;
  /**
   * How to read a streaming answer.
   *
   * Defaults to the `fetch` + `ReadableStream` path, which React Native cannot
   * use — its `fetch` has no `response.body`. Native passes `xhrSse` instead.
   */
  sse?: SseTransport;
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  signal?: AbortSignal;
};

/**
 * Whether a failure is "that playlist holds the other sort of thing".
 *
 * The server says so with a `conflict` plus a `kind` field naming what the
 * playlist actually holds and an `expected` naming what it would have taken.
 * Exported because the UI's answer to it is a whole flow — say no, then offer
 * to make the right playlist — and every caller recognising it by hand would
 * eventually recognise it differently.
 */
export function isWrongPlaylistKind(error: unknown): error is ApiClientError {
  return (
    error instanceof ApiClientError &&
    error.code === 'conflict' &&
    error.fields?.['kind'] !== undefined &&
    error.fields['expected'] !== undefined
  );
}

/** What the playlist should have been, from a `isWrongPlaylistKind` failure. */
export function expectedPlaylistKind(error: ApiClientError): PlaylistKind {
  return error.fields?.['expected'] === 'podcast' ? 'podcast' : 'episode';
}

export function createClient(options: ClientOptions) {
  const doFetch = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const sse = options.sse ?? fetchSse;

  /**
   * Turn the banner's server-relative path into a URL an `<img>` can use.
   *
   * The server deliberately does not know its own public origin — baking a
   * deployment URL into a serialiser is how staging ends up handing out links
   * to production. The client is the layer that already holds `baseUrl`, so it
   * is the layer that can resolve one, and doing it here means no screen has to
   * remember to.
   */
  function withAbsoluteBanner<T extends Playlist>(playlist: T): T {
    const path = playlist.banner.imageUrl;
    if (!path || path.startsWith('http')) return playlist;

    return {
      ...playlist,
      banner: { ...playlist.banner, imageUrl: `${baseUrl}${path}` },
    };
  }


  async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
    const url = new URL(`${baseUrl}${path}`);

    for (const [key, value] of Object.entries(init.query ?? {})) {
      // Skipping null/undefined means callers can pass optional filters
      // straight through without building the query string conditionally.
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = { accept: 'application/json' };
    if (init.body !== undefined) headers['content-type'] = 'application/json';

    const token = await options.getAuthToken?.();
    if (token) headers['authorization'] = `Bearer ${token}`;

    let response: Response;
    try {
      response = await doFetch(url.href, {
        method: init.method ?? 'GET',
        headers,
        // Cookies carry the session on web; harmless on native.
        credentials: 'include',
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        ...(init.signal ? { signal: init.signal } : {}),
      });
    } catch (error) {
      // An aborted request is the caller's own doing — a navigation, a new
      // keystroke in search. Rethrow so it isn't reported as a network fault.
      //
      // Checked by name rather than `instanceof DOMException`: that global is
      // not guaranteed to exist on React Native, and referencing a missing
      // global throws a ReferenceError that would mask the real error.
      if (isAbortError(error)) throw error;

      throw new ApiClientError(
        { code: 'upstream_unavailable', message: 'Could not reach the server' },
        0,
      );
    }

    let payload: ApiResult<T>;
    try {
      payload = (await response.json()) as ApiResult<T>;
    } catch {
      throw new ApiClientError(
        { code: 'internal', message: 'The server sent a response we could not read' },
        response.status,
      );
    }

    if (!payload.ok) throw new ApiClientError(payload.error, response.status);

    return payload.data;
  }

  /**
   * The auth endpoints answer in Better Auth's own shape, not this API's
   * `{ok, data}` envelope, so they get their own thin path rather than being
   * forced through `request`.
   */
  async function authRequest<T>(path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}/auth${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiClientError(
        { code: 'upstream_unavailable', message: 'Could not reach the server' },
        0,
      );
    }

    const payload = (await response.json().catch(() => null)) as
      | (T & { message?: string; code?: string })
      | null;

    if (!response.ok) {
      // Better Auth's own message is written for people and is more specific
      // than anything generic we could substitute ("Invalid email or
      // password" beats "Request failed").
      throw new ApiClientError(
        {
          code: response.status === 401 ? 'unauthorized' : 'bad_request',
          message: payload?.message ?? 'Could not sign you in',
          ...(payload?.code ? { authCode: payload.code } : {}),
        },
        response.status,
      );
    }

    if (!payload) {
      throw new ApiClientError(
        { code: 'internal', message: 'The server sent a response we could not read' },
        response.status,
      );
    }

    return payload;
  }

  return {
    /**
     * Create an account. Returns the session token so a native client can put
     * it in the keystore; on the web the cookie has already been set and the
     * token is ignored.
     */
    signUp(input: { email: string; password: string; name: string }) {
      return authRequest<{ token: string; user: { id: string } }>('/sign-up/email', input);
    },

    signIn(input: { email: string; password: string }) {
      return authRequest<{ token: string; user: { id: string } }>('/sign-in/email', input);
    },

    signOut() {
      return authRequest<Record<string, never>>('/sign-out', {});
    },

    /**
     * Confirm an address with the code that was emailed to it.
     *
     * Signs the account in on success, so a new user goes from the code straight
     * into the app rather than being returned to a sign-in form to type the
     * password they entered ninety seconds ago.
     */
    verifyEmail(input: { email: string; otp: string }) {
      return authRequest<{ token: string; user: { id: string } }>(
        '/email-otp/verify-email',
        input,
      );
    },

    /**
     * Send a fresh verification code.
     *
     * Needed for more than a lost email: with verification required, an account
     * created before this shipped — or one whose first code expired — has no
     * other way back in.
     */
    sendVerificationOtp(input: { email: string }) {
      return authRequest<{ success: boolean }>('/email-otp/send-verification-otp', {
        ...input,
        type: 'email-verification',
      });
    },

    /** The signed-in user, or null. Never throws for an anonymous caller. */
    getMe(): Promise<{ user: SessionUser | null }> {
      return request('/me');
    },

    listSubscriptions(
      params: { cursor?: Cursor | null; limit?: number } = {},
    ): Promise<Page<LibraryPodcast>> {
      return request('/me/subscriptions', {
        query: { cursor: params.cursor, limit: params.limit },
      });
    },

    subscribe(podcastId: string): Promise<{ subscribed: boolean }> {
      return request(`/me/subscriptions/${podcastId}`, { method: 'PUT' });
    },

    unsubscribe(podcastId: string): Promise<{ subscribed: boolean }> {
      return request(`/me/subscriptions/${podcastId}`, { method: 'DELETE' });
    },

    isSubscribed(podcastId: string): Promise<{ subscribed: boolean }> {
      return request(`/me/subscriptions/${podcastId}`);
    },

    // ------------------------------------------------------------ playback --

    getProgress(episodeId: string): Promise<{ progress: StoredProgress | null }> {
      return request(`/me/progress/${episodeId}`);
    },

    /** Report a position. The server reconciles and returns the resolved truth. */
    reportProgress(
      episodeId: string,
      body: {
        positionSec: number;
        durationSec: number | null;
        completed: boolean;
        deviceId: string;
        observedAt: number;
      },
    ): Promise<{ progress: StoredProgress; superseded: boolean }> {
      return request(`/me/progress/${episodeId}`, { method: 'PUT', body });
    },

    /**
     * Episodes started and not finished, most recently touched first.
     *
     * What a listener came back for. Server-side it is one join, so the home
     * screen costs a single request rather than a progress lookup per row.
     */
    getContinue(limit?: number): Promise<{ items: ContinueEntry[] }> {
      return request('/me/continue', { query: { limit } });
    },

    getRecommendations(
      params: { limit?: number } = {},
    ): Promise<{ personalized: boolean; items: RecommendedPodcast[] }> {
      return request('/me/recommendations', { query: { limit: params.limit } });
    },

    /** Recently played, finished or not — the sibling of `getContinue`. */
    getHistory(limit = 10): Promise<{ items: HistoryEntry[] }> {
      return request('/me/history', { query: { limit } });
    },

    /** How much has been listened to, and to whom. */
    getStats(): Promise<ListeningStats> {
      return request('/me/stats');
    },

    getQueue(): Promise<{ items: QueueEntry[] }> {
      return request('/me/queue');
    },

    addToQueue(episodeId: string, playNext = false): Promise<{ queued: boolean }> {
      return request('/me/queue', { method: 'POST', body: { episodeId, playNext } });
    },

    removeFromQueue(episodeId: string): Promise<{ queued: boolean }> {
      return request(`/me/queue/${episodeId}`, { method: 'DELETE' });
    },

    reorderQueue(episodeIds: string[]): Promise<{ reordered: number }> {
      return request('/me/queue/order', { method: 'PUT', body: { episodeIds } });
    },

    clearQueue(): Promise<{ cleared: boolean }> {
      return request('/me/queue', { method: 'DELETE' });
    },

    // ----------------------------------------------------------- playlists --

    listPlaylists(
      params: { cursor?: Cursor | null; limit?: number; kind?: PlaylistKind } = {},
    ): Promise<Page<Playlist>> {
      return request<Page<Playlist>>('/me/playlists', {
        query: { cursor: params.cursor, limit: params.limit, kind: params.kind },
      }).then((page) => ({ ...page, items: page.items.map(withAbsoluteBanner) }));
    },

    /** A playlist with its contents, in order. */
    getPlaylist(id: string): Promise<{ playlist: PlaylistDetail }> {
      return request<{ playlist: PlaylistDetail }>(`/me/playlists/${id}`).then((result) => ({
        playlist: withAbsoluteBanner(result.playlist),
      }));
    },

    createPlaylist(input: {
      title: string;
      /** Required: episodes or shows. The server has no default — see the type. */
      kind: PlaylistKind;
      description?: string | null;
      color?: PlaylistColor;
      bannerText?: string | null;
    }): Promise<{ playlist: Playlist }> {
      return request<{ playlist: Playlist }>('/me/playlists', {
        method: 'POST',
        body: input,
      }).then((result) => ({ playlist: withAbsoluteBanner(result.playlist) }));
    },

    /**
     * Rename, re-describe, or re-dress. Every field optional and independent —
     * sending only a title must not blank a description that was already there.
     */
    updatePlaylist(
      id: string,
      input: {
        title?: string;
        description?: string | null;
        color?: PlaylistColor;
        bannerKind?: 'color' | 'image';
        bannerText?: string | null;
        backgroundColor?: PlaylistColor | null;
      },
    ): Promise<{ playlist: Playlist }> {
      return request<{ playlist: Playlist }>(`/me/playlists/${id}`, {
        method: 'PATCH',
        body: input,
      }).then((result) => ({ playlist: withAbsoluteBanner(result.playlist) }));
    },

    deletePlaylist(id: string): Promise<{ deleted: boolean }> {
      return request(`/me/playlists/${id}`, { method: 'DELETE' });
    },

    /**
     * Upload a banner.
     *
     * The file goes up as the whole body rather than in a multipart envelope —
     * there is one file and no other fields, so a boundary would be ceremony.
     * This is the one call that does not go through `request`, which serialises
     * its body as JSON and would turn a Blob into `{}`.
     */
    async uploadPlaylistBanner(id: string, file: Blob): Promise<{ playlist: Playlist }> {
      const headers: Record<string, string> = {
        accept: 'application/json',
        'content-type': file.type || 'application/octet-stream',
      };

      const token = await options.getAuthToken?.();
      if (token) headers['authorization'] = `Bearer ${token}`;

      let response: Response;
      try {
        response = await doFetch(`${baseUrl}/me/playlists/${id}/banner`, {
          method: 'POST',
          headers,
          credentials: 'include',
          body: file,
        });
      } catch (error) {
        if (isAbortError(error)) throw error;
        throw new ApiClientError(
          { code: 'upstream_unavailable', message: 'Could not reach the server' },
          0,
        );
      }

      let payload: ApiResult<{ playlist: Playlist }>;
      try {
        payload = (await response.json()) as ApiResult<{ playlist: Playlist }>;
      } catch {
        throw new ApiClientError(
          { code: 'internal', message: 'The server sent a response we could not read' },
          response.status,
        );
      }

      if (!payload.ok) throw new ApiClientError(payload.error, response.status);

      return { playlist: withAbsoluteBanner(payload.data.playlist) };
    },

    /** Drop the picture; the playlist falls back to its colour. */
    removePlaylistBanner(id: string): Promise<{ playlist: Playlist }> {
      return request<{ playlist: Playlist }>(`/me/playlists/${id}/banner`, {
        method: 'DELETE',
      }).then((result) => ({ playlist: withAbsoluteBanner(result.playlist) }));
    },

    addToPlaylist(
      playlistId: string,
      episodeId: string,
      position: 'start' | 'end' = 'end',
    ): Promise<{ added: boolean }> {
      return request(`/me/playlists/${playlistId}/items`, {
        method: 'POST',
        body: { episodeId, position },
      });
    },

    removeFromPlaylist(playlistId: string, episodeId: string): Promise<{ removed: boolean }> {
      return request(`/me/playlists/${playlistId}/items/${episodeId}`, { method: 'DELETE' });
    },

    reorderPlaylist(playlistId: string, episodeIds: string[]): Promise<{ reordered: number }> {
      return request(`/me/playlists/${playlistId}/order`, {
        method: 'PUT',
        body: { episodeIds },
      });
    },

    /**
     * Put a whole show in a show playlist.
     *
     * Answers `conflict` when the playlist holds episodes. That is not a bug to
     * paper over: it is the signal the UI turns into an offer to make the right
     * kind of playlist instead. See `isWrongPlaylistKind`.
     */
    addPodcastToPlaylist(
      playlistId: string,
      podcastId: string,
      position: 'start' | 'end' = 'end',
    ): Promise<{ added: boolean }> {
      return request(`/me/playlists/${playlistId}/podcasts`, {
        method: 'POST',
        body: { podcastId, position },
      });
    },

    removePodcastFromPlaylist(
      playlistId: string,
      podcastId: string,
    ): Promise<{ removed: boolean }> {
      return request(`/me/playlists/${playlistId}/podcasts/${podcastId}`, {
        method: 'DELETE',
      });
    },

    reorderPlaylistPodcasts(
      playlistId: string,
      podcastIds: string[],
    ): Promise<{ reordered: number }> {
      return request(`/me/playlists/${playlistId}/podcasts/order`, {
        method: 'PUT',
        body: { podcastIds },
      });
    },

    /**
     * Which playlists already hold this episode.
     *
     * One request for the whole answer, so an "add to playlist" sheet shows its
     * ticks the moment it opens rather than firing a membership check per row.
     */
    playlistsContaining(episodeId: string): Promise<{ playlistIds: string[] }> {
      return request(`/me/playlists/containing/${episodeId}`);
    },

    /** The same question for a whole show. */
    playlistsContainingPodcast(podcastId: string): Promise<{ playlistIds: string[] }> {
      return request(`/me/playlists/containing-podcast/${podcastId}`);
    },

    /**
     * Search the directory. Results are not yet in our catalog — they have a
     * feed URL, not an id.
     */
    searchPodcasts(
      query: string,
      params: { language?: string; limit?: number; signal?: AbortSignal } = {},
      /**
       * `degraded` is set when the directory was unreachable and these results
       * came from our own catalogue instead.
       *
       * Optional because it is absent on the ordinary path rather than false —
       * the server only says so when it has something to say. The distinction
       * matters to the caller: a short list is not evidence of anything on its
       * own, and this is what separates "three matches" from "three matches,
       * and search is currently only seeing part of the world".
       */
    ): Promise<{ results: PodcastSearchResult[]; degraded?: boolean }> {
      return request('/podcasts/search', {
        query: { q: query, language: params.language, limit: params.limit },
        ...(params.signal ? { signal: params.signal } : {}),
      });
    },

    /** The catalogue's categories, each with a count and a borrowed colour. */
    listCategories(): Promise<{ items: Category[] }> {
      return request('/categories');
    },

    trendingPodcasts(
      params: { language?: string; limit?: number } = {},
    ): Promise<{ results: PodcastSearchResult[] }> {
      return request('/podcasts/trending', {
        query: { language: params.language, limit: params.limit },
      });
    },

    /** Add a feed to the catalog, ingesting it. Returns the stored show. */
    addPodcast(feedUrl: string): Promise<{ podcast: Podcast }> {
      return request('/podcasts', { method: 'POST', body: { feedUrl } });
    },

    /** The catalog, most recently active first, optionally one category of it. */
    getPodcasts(
      params: { cursor?: Cursor | null; limit?: number; category?: string } = {},
    ): Promise<Page<Podcast>> {
      return request('/podcasts', {
        query: {
          cursor: params.cursor,
          limit: params.limit,
          category: params.category,
        },
      });
    },

    getPodcast(id: string): Promise<{ podcast: Podcast }> {
      return request(`/podcasts/${id}`);
    },

    getEpisodes(
      podcastId: string,
      params: { cursor?: Cursor | null; limit?: number; signal?: AbortSignal } = {},
    ): Promise<Page<Episode>> {
      return request(`/podcasts/${podcastId}/episodes`, {
        query: { cursor: params.cursor, limit: params.limit },
        ...(params.signal ? { signal: params.signal } : {}),
      });
    },

    /**
     * One numbered page of a show's episodes.
     *
     * A separate method rather than an optional `page` on `getEpisodes`,
     * because the two return different shapes and a union return type would put
     * a narrowing check at every call site to answer a question the caller
     * already knew when it picked the arguments.
     */
    getEpisodePage(
      podcastId: string,
      params: { page: number; limit?: number; signal?: AbortSignal },
    ): Promise<NumberedPage<Episode>> {
      return request(`/podcasts/${podcastId}/episodes`, {
        query: { page: params.page, limit: params.limit },
        ...(params.signal ? { signal: params.signal } : {}),
      });
    },

    getEpisode(
      id: string,
      params: { signal?: AbortSignal } = {},
    ): Promise<{ episode: Episode }> {
      return request(`/episodes/${id}`, { signal: params.signal });
    },

    /**
     * The dominant colour of an episode's artwork.
     *
     * Asked for separately from the episode itself because a first request can
     * mean the server fetching the image from a publisher's CDN. The player
     * shows the show's colour immediately and swaps when this answers, so this
     * is never on the path to a first paint.
     *
     * `source` says which artwork the colour actually came from: `episode` when
     * it was sampled from this episode's own cover, `podcast` when the episode
     * has none of its own and the show's is the honest answer rather than a
     * placeholder.
     */
    getEpisodeTint(
      id: string,
      params: { signal?: AbortSignal } = {},
    ): Promise<{ accentColor: string | null; source: 'episode' | 'podcast' }> {
      return request(`/episodes/${id}/tint`, { signal: params.signal });
    },

    /**
     * The episode's transcript, fetched from the publisher on first read.
     *
     * `transcript: null` means the publisher offers none — distinct from a
     * transcript whose `status` is `failed`, which means we tried. The two get
     * different empty states, so they stay different on the wire.
     */
    getTranscript(
      episodeId: string,
      params: { signal?: AbortSignal } = {},
    ): Promise<{ transcript: Transcript | null; detail: string | null }> {
      return request(`/episodes/${episodeId}/transcript`, {
        ...(params.signal ? { signal: params.signal } : {}),
      });
    },

    // ---------------------------------------------------------------- ai --

    /**
     * Everything the AI panel needs, spending nothing.
     *
     * Deliberately one request rather than three: the panel cannot decide what
     * to offer without all of it at once. Whether "Summarise" is even possible
     * depends on the transcript, and whether to warn about the allowance
     * depends on the quota.
     */
    getEpisodeAi(
      episodeId: string,
      params: { language?: string; signal?: AbortSignal } = {},
    ): Promise<AiPanelState> {
      return request(`/episodes/${episodeId}/ai`, {
        query: { language: params.language },
        ...(params.signal ? { signal: params.signal } : {}),
      });
    },

    /**
     * Start generating a transcript.
     *
     * Returns once the work is under way, not once it is done — an hour of
     * audio takes minutes. Poll `getTranscript` for the result.
     */
    transcribeEpisode(
      episodeId: string,
    ): Promise<{ started: boolean; detail: string | null; quota: AiQuota }> {
      return request(`/episodes/${episodeId}/transcribe`, { method: 'POST' });
    },

    generateBrief(episodeId: string, params: { language?: string } = {}): Promise<AiGeneration> {
      return request(`/episodes/${episodeId}/ai/brief`, {
        method: 'POST',
        query: { language: params.language },
      });
    },

    generateChapters(episodeId: string, params: { language?: string } = {}): Promise<AiGeneration> {
      return request(`/episodes/${episodeId}/ai/chapters`, {
        method: 'POST',
        query: { language: params.language },
      });
    },

    getAiQuota(): Promise<{ quota: AiQuota }> {
      return request('/me/ai');
    },

    /** The account's own settings, as opposed to this device's. */
    getProfile(): Promise<{ profile: { locale: string | null; displayName: string | null } }> {
      return request('/me/profile');
    },

    setLocale(locale: string): Promise<{ profile: { locale: string } }> {
      return request('/me/profile', { method: 'PATCH', body: { locale } });
    },

    /**
     * Save a personal provider key.
     *
     * The key goes up once and is never returned. There is no endpoint that
     * reads it back — not masked, not partially — so the client must treat
     * this as write-only and show `quota.hint` afterwards.
     */
    saveApiKey(key: string): Promise<{ quota: AiQuota }> {
      return request('/me/ai/key', { method: 'PUT', body: { key } });
    },

    deleteApiKey(): Promise<{ quota: AiQuota }> {
      return request('/me/ai/key', { method: 'DELETE' });
    },

    /**
     * Ask about an episode, streamed token by token.
     *
     * Outside `request` because this is not JSON — it is an event stream, and
     * the whole point is that the caller sees the first words in a few hundred
     * milliseconds rather than the whole answer in several seconds.
     *
     * Callbacks rather than an async iterator: both UIs want to append to state
     * as tokens land, and an iterator would make every caller write the same
     * for-await loop around the same two lines.
     */
    async askEpisode(
      episodeId: string,
      params: {
        question: string;
        language?: string;
        onToken: (token: string) => void;
        onCitations?: (citations: AskCitation[]) => void;
        signal?: AbortSignal;
      },
    ): Promise<void> {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'text/event-stream',
      };

      const token = await options.getAuthToken?.();
      if (token) headers['authorization'] = `Bearer ${token}`;

      try {
        await sse({
          url: `${baseUrl}/episodes/${episodeId}/ask`,
          headers,
          body: JSON.stringify({
            question: params.question,
            ...(params.language ? { language: params.language } : {}),
          }),
          ...(params.signal ? { signal: params.signal } : {}),
          onFrame: (frame) => handleFrame(frame, params),
          /**
           * A failure *before* the stream opens is still a normal JSON
           * envelope — an unauthenticated caller, a spent quota, an episode
           * with no transcript. Those surface as the same `ApiClientError`
           * every other call throws, so no caller needs a second error path
           * for this one method.
           */
          onFailure: (status, raw) => {
            let payload: ApiResult<unknown> | null;
            try {
              payload = JSON.parse(raw) as ApiResult<unknown>;
            } catch {
              payload = null;
            }

            throw new ApiClientError(
              payload && !payload.ok
                ? payload.error
                : { code: 'internal', message: 'The answer could not be started' },
              status,
            );
          },
        });
      } catch (error) {
        if (isAbortError(error) || error instanceof ApiClientError) throw error;
        throw new ApiClientError(
          { code: 'upstream_unavailable', message: 'Could not reach the server' },
          0,
        );
      }
    },
  };
}

/** One SSE frame: an `event:` line and a `data:` line. */
function handleFrame(
  frame: string,
  params: { onToken: (token: string) => void; onCitations?: (citations: AskCitation[]) => void },
): void {
  let event = 'message';
  let data = '';

  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }

  if (!data) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return;
  }

  if (event === 'token') {
    const token = (parsed as { token?: unknown }).token;
    if (typeof token === 'string') params.onToken(token);
    return;
  }

  if (event === 'citations') {
    const citations = (parsed as { citations?: unknown }).citations;
    if (Array.isArray(citations)) params.onCitations?.(citations as AskCitation[]);
    return;
  }

  /**
   * The stream failed after the headers were already sent, so it could not be
   * a status code. Thrown here so it lands in the caller's catch alongside
   * every other failure rather than ending the stream silently, which would
   * look like a complete but truncated answer.
   */
  if (event === 'error') {
    const message = (parsed as { message?: unknown }).message;
    throw new ApiClientError(
      {
        code: 'upstream_unavailable',
        message: typeof message === 'string' ? message : 'The answer stopped unexpectedly',
      },
      200,
    );
  }
}

/** Cached generations plus the two facts that decide what can be offered. */
export type AiPanelState = {
  summary: string | null;
  takeaways: string[] | null;
  chapters: Chapter[] | null;
  transcript: {
    present: boolean;
    source: 'feed' | 'generated' | null;
    status: 'pending' | 'processing' | 'ready' | 'failed' | null;
    timed: boolean;
    /**
     * How far a running job has got, when the server answering knows.
     *
     * Null is not "no job" — it is "this instance is not the one doing it", or
     * the job has not reached a countable stage yet. Callers should read it as
     * extra detail on top of `status`, never as the thing that decides whether
     * work is happening.
     */
    progress: TranscribeProgress | null;
  };
  quota: AiQuota;
};

export type TranscribeProgress = {
  stage: 'fetching' | 'splitting' | 'transcribing' | 'waiting' | 'saving';
  /** Chunks finished, and how many there are. Both 0 before the split. */
  done: number;
  total: number;
  /**
   * When a `waiting` job resumes, as epoch milliseconds — absent otherwise.
   *
   * An instant rather than a duration, deliberately. The client polls every few
   * seconds, so seconds-remaining would arrive already stale and could only
   * advance in whatever ragged steps the poll landed on; a deadline stays true
   * between polls and lets the countdown run smoothly off the local clock.
   */
  waitingUntilMs?: number;
};

export type AiGeneration = {
  summary: string | null;
  takeaways: string[] | null;
  chapters: Chapter[] | null;
  quota: AiQuota;
};

export type CueClient = ReturnType<typeof createClient>;

/**
 * Push a queue change to the server.
 *
 * The player reports *what changed*; this is the one place that knows which
 * request each change corresponds to. Both clients call it, so the mapping
 * cannot drift between web and Android.
 *
 * Deliberately returns the promise rather than swallowing it: whether a failed
 * queue write is worth surfacing is the caller's decision, and the two
 * platforms answer it differently.
 */
export function applyQueueMutation(
  client: CueClient,
  mutation: QueueMutation,
): Promise<unknown> {
  switch (mutation.type) {
    case 'add':
      return client.addToQueue(mutation.episodeId, mutation.playNext);
    case 'remove':
      return client.removeFromQueue(mutation.episodeId);
    case 'reorder':
      return client.reorderQueue(mutation.episodeIds);
    case 'clear':
      return client.clearQueue();
  }
}
