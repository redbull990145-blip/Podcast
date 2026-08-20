/**
 * Recommended for you.
 *
 * A content-based ranker over data the app already holds — no model, no
 * external service, and nothing about a listener leaves this process. The
 * shape is deliberately boring: build an interest profile from listening
 * behaviour, score every candidate show against it, then spread the winners
 * across categories so the rail is not one subject repeated twelve times.
 *
 * The single most important property is that it degrades. A brand-new account
 * has no profile, so the score falls back to catalogue quality and the rail
 * looks like a reasonable front page rather than an empty box. Personal signal
 * is blended in as it accumulates.
 */

import {
  categories,
  episodes,
  playbackProgress,
  podcastCategories,
  podcasts,
  subscriptions,
  type PodcastRow,
} from '@cue/db';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/plugin.ts';
import { serializePodcast } from '../catalog/serialize.ts';
import { ok } from '../errors.ts';

/**
 * How much of the catalogue is re-ranked.
 *
 * Scoring is cheap per show but the rows still have to be read, and a rail of
 * eighteen covers does not get better by considering ten thousand candidates.
 * Recency orders the pool, so the ceiling is "the 250 most recently active
 * shows" — which is also the pool anyone browsing would have seen anyway.
 */
const CANDIDATE_LIMIT = 250;

/** Episodes of history read per request. Roughly a year of ordinary listening. */
const HISTORY_LIMIT = 200;

/**
 * How fast an old listen stops counting.
 *
 * Forty-five days to half weight: long enough that a fortnight away does not
 * wipe someone's taste, short enough that a phase they have moved on from
 * stops dominating the rail within a couple of months.
 */
const HALF_LIFE_DAYS = 45;

/** How long a computed rail is reused. Long enough to matter, short enough to feel live. */
const CACHE_TTL_SEC = 600;

type InterestProfile = {
  /** Total signal collected. Decides whether the ranker leans on the profile at all. */
  total: number;
  categories: Map<string, number>;
  authors: Map<string, number>;
  keywords: Map<string, number>;
  /** Episodes already heard, per podcast id. */
  consumed: Map<string, number>;
};

type Candidate = {
  podcast: PodcastRow;
  categories: string[];
};

type ScoredCandidate = Candidate & { score: number };

const recommendationsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(18),
});

/**
 * Text reduced to something two strings can be compared on.
 *
 * Accents are folded rather than dropped by codepoint, so `Café` and `Cafe`
 * are the same word — and everything that is not a letter or digit becomes a
 * space, which means punctuation, em dashes and emoji in a show title cannot
 * split a word in half or fuse two together.
 */
function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * The words in a string worth matching on.
 *
 * Short words carry no topic, and the stop list is the handful that would
 * otherwise match *everything* in a podcast catalogue. Without it, "podcast"
 * is the strongest shared keyword in the database and every show looks related
 * to every other one.
 */
function tokens(value: string | null | undefined): string[] {
  const stop = new Set([
    'the',
    'and',
    'for',
    'with',
    'podcast',
    'show',
    'episode',
    'episodes',
    'from',
    'this',
    'that',
    'your',
    'about',
  ]);

  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 4 && !stop.has(token));
}

function add(map: Map<string, number>, key: string | null | undefined, amount: number): void {
  const normalized = normalizeText(key);
  if (!normalized) return;
  map.set(normalized, (map.get(normalized) ?? 0) + amount);
}

/** Exponential decay, floored so an old favourite never counts for literally nothing. */
function recencyMultiplier(date: Date, now: number): number {
  const ageDays = Math.max(0, (now - date.getTime()) / 86_400_000);
  return Math.max(0.25, Math.pow(0.5, ageDays / HALF_LIFE_DAYS));
}

/**
 * What one episode of history is worth.
 *
 * Not every play means the same thing, and treating them equally is how a rail
 * ends up recommending more of the show someone opened once and closed. The
 * steps are deliberately coarse — started, stayed, nearly finished, finished —
 * because the difference between 61% and 64% of an episode is noise and the
 * difference between abandoning at two minutes and reaching the end is not.
 *
 * A missing duration is common in the wild, so completion falls back to the
 * `completed` flag and elapsed time rather than scoring zero.
 */
function listeningSignal(
  input: {
    positionSec: number;
    durationSec: number | null;
    completed: boolean;
    updatedAt: Date;
  },
  now: number,
): number {
  const duration = input.durationSec;
  const fraction = duration && duration > 0 ? input.positionSec / duration : 0;

  let signal = 1;
  signal += Math.min(4, input.positionSec / 300);
  if (fraction >= 0.5) signal += 4;
  if (fraction >= 0.8) signal += 6;
  if (input.completed) signal += 10;

  return signal * recencyMultiplier(input.updatedAt, now);
}

function freshnessScore(date: Date | null, now: number): number {
  if (!date) return 0;
  const ageDays = Math.max(0, (now - date.getTime()) / 86_400_000);
  return Math.max(0, 8 - ageDays / 14);
}

/**
 * What a show is worth to somebody we know nothing about.
 *
 * This is the whole cold-start answer, and it is also the floor under every
 * personalised score — so a show with strong category overlap and no episodes
 * still loses to one that is actually listenable. Depth via `log10` rather
 * than the raw count, because the interesting difference is between three
 * episodes and three hundred, not between three hundred and three thousand.
 */
function catalogueScore(podcast: PodcastRow, now: number): number {
  const episodeCount = podcast.episodeCount ?? 0;

  return (
    freshnessScore(podcast.lastPublishedAt, now) +
    Math.min(8, Math.log10(episodeCount + 1) * 3) +
    // Seeded shows were chosen by a person, which is the only editorial signal
    // this database has.
    (podcast.source === 'seed' ? 3 : 0) +
    (podcast.artworkUrl ? 1 : 0)
  );
}

/**
 * Topic overlap that does not depend on anyone having tagged anything.
 *
 * Categories are the strong signal, but a large share of feeds in the wild
 * carry none — and for those, the words in the title and description are the
 * only statement of the subject that exists. Each token is capped so one
 * obsessively repeated word cannot outweigh the categories.
 */
function keywordScore(profile: InterestProfile, candidate: Candidate): number {
  const candidateTokens = new Set(
    tokens(
      [
        candidate.podcast.title,
        candidate.podcast.author,
        candidate.podcast.description,
        candidate.categories.join(' '),
      ].join(' '),
    ),
  );

  let score = 0;
  for (const [token, weight] of profile.keywords) {
    if (candidateTokens.has(token)) score += Math.min(14, weight * 0.35);
  }

  return score;
}

function recommendationScore(
  profile: InterestProfile,
  candidate: Candidate,
  now: number,
): number {
  let score = catalogueScore(candidate.podcast, now);

  for (const category of candidate.categories) {
    score += (profile.categories.get(normalizeText(category)) ?? 0) * 1.7;
  }

  score += (profile.authors.get(normalizeText(candidate.podcast.author)) ?? 0) * 0.9;
  score += keywordScore(profile, candidate);

  /*
    Already heard it.

    Not a ban: one episode of a show is how someone finds out they like it, and
    hiding it immediately would make the rail useless for exactly the shows
    that are working. Two or more episodes means the discovery already
    happened, and a rail whose job is to introduce something should stop
    spending a slot on it. Following the show removes it from the pool
    outright, further down.
  */
  const consumed = profile.consumed.get(candidate.podcast.id) ?? 0;
  if (consumed >= 2) score -= 10 + consumed * 3;

  return score;
}

/**
 * Spread the winners across subjects.
 *
 * Pure score ordering is what makes a personalised rail feel narrow: someone
 * who listens to a lot of motivation gets eighteen motivation shows and
 * nothing they could not have found on their own. Capping any one category at
 * roughly 45% of the rail keeps the dominant interest dominant while leaving
 * room for whatever scored next — which, because scores come from shared
 * keywords and authors as well as categories, is usually an adjacent subject
 * rather than a random one.
 *
 * The second pass refills from the rejects if the cap left the rail short. A
 * short rail is worse than a slightly repetitive one.
 */
function diversify(candidates: ScoredCandidate[], limit: number): ScoredCandidate[] {
  const selected: ScoredCandidate[] = [];
  const taken = new Set<string>();
  const categoryCounts = new Map<string, number>();
  const categoryCap = Math.max(2, Math.ceil(limit * 0.45));

  for (const candidate of candidates) {
    const primary = normalizeText(candidate.categories[0]);
    const count = primary ? (categoryCounts.get(primary) ?? 0) : 0;
    if (primary && count >= categoryCap) continue;

    selected.push(candidate);
    taken.add(candidate.podcast.id);
    if (primary) categoryCounts.set(primary, count + 1);
    if (selected.length === limit) return selected;
  }

  for (const candidate of candidates) {
    if (taken.has(candidate.podcast.id)) continue;
    selected.push(candidate);
    if (selected.length === limit) return selected;
  }

  return selected;
}

/**
 * Categories for a set of shows, in one query.
 *
 * Deliberately not a join on the queries below. A show carries several
 * categories, so joining multiplies its row — and every one of those queries
 * is `LIMIT`ed, which means the limit silently starts counting *pairings*
 * instead of podcasts. On a well-tagged catalogue 250 candidate rows is
 * eighty-odd actual shows, and the bug is invisible from outside because the
 * endpoint still returns a full rail.
 */
async function categoriesFor(
  app: FastifyInstance,
  podcastIds: string[],
): Promise<Map<string, string[]>> {
  const byPodcast = new Map<string, string[]>();
  if (podcastIds.length === 0) return byPodcast;

  const rows = await app.db
    .select({ podcastId: podcastCategories.podcastId, name: categories.name })
    .from(podcastCategories)
    .innerJoin(categories, eq(categories.id, podcastCategories.categoryId))
    .where(inArray(podcastCategories.podcastId, podcastIds));

  for (const row of rows) {
    const existing = byPodcast.get(row.podcastId);
    if (existing) existing.push(row.name);
    else byPodcast.set(row.podcastId, [row.name]);
  }

  return byPodcast;
}

export function recommendationRoutes(app: FastifyInstance): void {
  /**
   * The Recommended rail, personalised.
   *
   * Signed-in only, because there is nothing to personalise against otherwise.
   * Both clients fall back to the plain catalogue for anonymous visitors, which
   * is very nearly what this returns for a brand-new account anyway.
   */
  app.get('/me/recommendations', async (request) => {
    const user = requireUser(request);
    const { limit } = recommendationsQuery.parse(request.query);

    /*
      Ten minutes of reuse.

      Recomputing on every Home load means four queries and 250 scored shows to
      produce a rail that moves when somebody finishes an episode — which is
      not a per-second event. Redis is optional here as everywhere: an
      unreachable cache is a miss, and the request proceeds.
    */
    const cacheKey = `recommendations:${user.id}:${limit}`;
    const cached = await app.cache.get<{ items: unknown[] }>(cacheKey);
    if (cached) return ok(cached);

    const now = Date.now();

    /*
      Shows the listener already follows are not candidates.

      They are a very strong statement about taste — see below, where they feed
      the profile — and simultaneously the worst possible thing to put in a
      rail whose job is to introduce something. `NOT EXISTS` rather than a left
      join and a null check, so the planner can stop at the first match.
    */
    const candidateRows = await app.db
      .select()
      .from(podcasts)
      .where(
        sql`NOT EXISTS (
          SELECT 1 FROM ${subscriptions}
          WHERE ${subscriptions.podcastId} = ${podcasts.id}
            AND ${subscriptions.userId} = ${user.id}
        )`,
      )
      .orderBy(sql`${podcasts.lastPublishedAt} DESC NULLS LAST`, desc(podcasts.id))
      .limit(CANDIDATE_LIMIT);

    if (candidateRows.length === 0) return ok({ items: [] });

    const historyRows = await app.db
      .select({
        podcast: podcasts,
        positionSec: playbackProgress.positionSec,
        durationSec: playbackProgress.durationSec,
        episodeDurationSec: episodes.durationSec,
        completed: playbackProgress.completed,
        updatedAt: playbackProgress.updatedAt,
      })
      .from(playbackProgress)
      .innerJoin(episodes, eq(episodes.id, playbackProgress.episodeId))
      .innerJoin(podcasts, eq(podcasts.id, episodes.podcastId))
      .where(eq(playbackProgress.userId, user.id))
      .orderBy(desc(playbackProgress.updatedAt))
      .limit(HISTORY_LIMIT);

    const subscriptionRows = await app.db
      .select({ podcast: podcasts })
      .from(subscriptions)
      .innerJoin(podcasts, eq(podcasts.id, subscriptions.podcastId))
      .where(eq(subscriptions.userId, user.id));

    // Every show involved, in one lookup: candidates so the rail can carry its
    // categories, history and subscriptions so the profile has topics.
    const categoryMap = await categoriesFor(app, [
      ...new Set([
        ...candidateRows.map((row) => row.id),
        ...historyRows.map((row) => row.podcast.id),
        ...subscriptionRows.map((row) => row.podcast.id),
      ]),
    ]);

    const profile: InterestProfile = {
      total: 0,
      categories: new Map(),
      authors: new Map(),
      keywords: new Map(),
      consumed: new Map(),
    };

    for (const row of historyRows) {
      const signal = listeningSignal(
        {
          positionSec: row.positionSec,
          // The stored duration is what the player measured; the episode's is
          // what the feed claimed. Either beats scoring no progress at all.
          durationSec: row.durationSec ?? row.episodeDurationSec,
          completed: row.completed,
          updatedAt: row.updatedAt,
        },
        now,
      );

      profile.total += signal;
      profile.consumed.set(row.podcast.id, (profile.consumed.get(row.podcast.id) ?? 0) + 1);
      add(profile.authors, row.podcast.author, signal);

      for (const category of categoryMap.get(row.podcast.id) ?? []) {
        add(profile.categories, category, signal);
      }
      for (const token of tokens(`${row.podcast.title} ${row.podcast.description ?? ''}`)) {
        add(profile.keywords, token, signal * 0.35);
      }
    }

    /*
      Following a show is the loudest thing anyone tells this system.

      It is an explicit, deliberate statement of interest, where a play is a
      guess that might not have survived the first ten minutes — so it is worth
      roughly what a completed episode is. Undecayed, because a subscription
      does not get less true with age; it gets cancelled.
    */
    for (const row of subscriptionRows) {
      const signal = 18;
      profile.total += signal;
      add(profile.authors, row.podcast.author, signal);

      for (const category of categoryMap.get(row.podcast.id) ?? []) {
        add(profile.categories, category, signal);
      }
      for (const token of tokens(`${row.podcast.title} ${row.podcast.description ?? ''}`)) {
        add(profile.keywords, token, signal * 0.25);
      }
    }

    /*
      One or two half-listened episodes is not a taste.

      Below this the profile is mostly noise — a single comedy episode would
      make the whole rail comedy — so the catalogue score stands alone. It is
      not a permanent classification in either direction: the profile is built
      from scratch on every request, so it follows what someone is listening to
      now rather than what they listened to once.
    */
    const personalized = profile.total >= 5;

    const candidates: Candidate[] = candidateRows.map((podcast) => ({
      podcast,
      categories: categoryMap.get(podcast.id) ?? [],
    }));

    const scored: ScoredCandidate[] = candidates
      .map((candidate) => ({
        ...candidate,
        score: personalized
          ? recommendationScore(profile, candidate, now)
          : catalogueScore(candidate.podcast, now),
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.podcast.lastPublishedAt?.getTime() ?? 0) -
            (a.podcast.lastPublishedAt?.getTime() ?? 0),
      );

    const payload = {
      items: diversify(scored, limit).map((candidate) =>
        serializePodcast(candidate.podcast, candidate.categories),
      ),
    };

    await app.cache.set(cacheKey, payload, CACHE_TTL_SEC);

    return ok(payload);
  });
}
