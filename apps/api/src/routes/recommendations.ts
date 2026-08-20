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
import type { RecommendationReason } from '@cue/types';
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

/**
 * How far behind a show falls once the listener has clearly found it.
 *
 * Larger than any score this ranker can produce, so it is an ordering rule
 * rather than a weight: nothing a candidate accumulates from categories,
 * creators, keywords or catalogue quality can lift a discovered show back above
 * one the listener has never heard.
 */
const DISCOVERED = 1_000;

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

/**
 * How much a shared category is worth, given how many shows carry it.
 *
 * A tag is only evidence to the extent that not everything has it. "News" is
 * carried by a third of the catalogue — a daily politics show, a web
 * development podcast and a true-crime series all declare it — so two shows
 * sharing it says close to nothing, while sharing "Tech News" says a great
 * deal. Scoring them identically is how somebody who listens to the news gets
 * recommended a JavaScript show and is told it is because they like News.
 *
 * Inverse document frequency, computed over the candidate pool rather than the
 * whole catalogue — the pool is already in memory, it is a large sample of the
 * same distribution, and the alternative is another aggregate query per
 * request to refine a weight, not to decide one.
 *
 * Clamped at both ends. A category nothing else carries would otherwise score
 * unboundedly high on a small catalogue, and one that everything carries has to
 * stay worth *something*, because on a young install the broad tags are all
 * there is.
 */
function categorySpecificity(shareOfPool: number): number {
  if (shareOfPool <= 0) return 1;
  return Math.min(1.6, Math.max(0.35, Math.log(1 / shareOfPool) / Math.log(4)));
}

function recommendationScore(
  profile: InterestProfile,
  candidate: Candidate,
  now: number,
  specificity: Map<string, number>,
): number {
  let score = catalogueScore(candidate.podcast, now);

  for (const category of candidate.categories) {
    const key = normalizeText(category);
    score +=
      (profile.categories.get(key) ?? 0) * 1.7 * (specificity.get(key) ?? 1);
  }

  score += (profile.authors.get(normalizeText(candidate.podcast.author)) ?? 0) * 0.9;
  score += keywordScore(profile, candidate);

  /*
    Already heard it.

    Not a ban: one episode of a show is how someone finds out they like it, and
    hiding it immediately would make the rail useless for exactly the shows
    that are working. Two or more episodes means the discovery already
    happened, and a rail whose job is to introduce something should stop
    spending a slot on it.

    `DISCOVERED` rather than a tuned deduction, because a deduction does not do
    the job. This was `-10 - consumed * 3`, which sounds decisive and is not:
    the same listening that marks a show as discovered also piles category and
    creator weight onto it, and in practice the show somebody had just finished
    two episodes of came back as their *top* recommendation — captioned "More
    from" its own host. The rule being expressed is ordinal, not arithmetic
    ("behind everything unheard"), so it is written as a number no accumulated
    signal can climb back over rather than as one that happened to be big
    enough on the day it was picked.

    They stay in the pool rather than being filtered out, so a rail is never
    short on a small catalogue — `diversify` will reach them once nothing
    unheard is left. Following a show does remove it outright, further down.
  */
  const consumed = profile.consumed.get(candidate.podcast.id) ?? 0;
  if (consumed >= 2) score -= DISCOVERED;

  return score;
}

/**
 * Why this show, in one fact.
 *
 * Deliberately **not** an argmax over the score's own terms, which is the
 * obvious implementation and the wrong one. Categories are weighted heavier
 * than creators when ranking, because a category is the broader and more
 * reliable predictor — but breadth is exactly what makes it the weaker
 * *explanation*. "More in Self Improvement" is true of four shows in the
 * catalogue; "More from Coach Reed" names the actual connection, and a reader
 * can tell instantly whether they agree with it.
 *
 * So the caption prefers the creator whenever that connection is real, and
 * falls back to the category when the shared author is incidental — someone
 * who listens to forty business shows should not be told "More from Dana
 * Okoro" because one of them happened to be hers. Half the category's weight
 * is the line: enough to mean the creator was genuinely part of why this
 * scored, not so much that only a superfan clears it.
 *
 * Raw profile weights rather than the multiplied ones, because the multipliers
 * exist to balance the *sum* and have no meaning in a comparison whose whole
 * question is which fact to print.
 *
 * Falls back to `popular` rather than guessing. A show that won on catalogue
 * quality has no connection to this listener, and captioning it "because you
 * like Business" when they have never played a business show is the kind of
 * fabricated personalisation that teaches people to distrust the whole rail.
 */
function reasonFor(
  profile: InterestProfile,
  candidate: Candidate,
  personalized: boolean,
  specificity: Map<string, number>,
): RecommendationReason {
  if (!personalized) return { kind: 'popular', subject: null };

  let category: string | null = null;
  let categoryWeight = 0;

  /*
    Weighted by specificity, exactly as the score is.

    Otherwise the caption names whichever of the show's categories this listener
    has the most history in, regardless of how central it is to the show — and
    since the broad tags are the ones most listeners accumulate weight in, that
    is reliably the *least* descriptive label the show carries. Syntax is tagged
    Technology, News and Tech News; captioning it "More in News" to a reader of
    the news is true of the data and false about the show.
  */
  for (const name of candidate.categories) {
    const key = normalizeText(name);
    const weight = (profile.categories.get(key) ?? 0) * (specificity.get(key) ?? 1);
    if (weight > categoryWeight) {
      categoryWeight = weight;
      category = name;
    }
  }

  const author = candidate.podcast.author;
  const authorWeight = profile.authors.get(normalizeText(author)) ?? 0;

  if (author && authorWeight > 0 && authorWeight >= categoryWeight * 0.5) {
    return { kind: 'creator', subject: author };
  }

  if (category && categoryWeight > 0) {
    return { kind: 'category', subject: category };
  }

  return { kind: 'popular', subject: null };
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
      Deliberately not cached.

      This endpoint had a ten-minute Redis TTL, on the reasonable-sounding
      grounds that four queries and 250 scored shows is real work for a list
      that changes when somebody finishes an episode. Running it revealed what
      the tests could not: the ten minutes lands squarely on the one moment the
      feature exists for. A new listener plays their first two episodes, opens
      Home, and every card still says "Popular right now" — because the rail
      they are looking at was computed before they had a taste. The transition
      from cold start to personalised is the whole product, and a time-based
      cache is guaranteed to hide it.

      A TTL is simply the wrong invalidation strategy for data whose purpose is
      to track a fast-moving signal. The right one is invalidate-on-write, and
      it is not free here: the cache key would have to carry `limit` (the
      clients ask for different sizes) so a single `del` cannot clear it, and
      the write to invalidate on is the progress heartbeat, which is the
      highest-frequency write in the app.

      So: no cache, because four indexed queries and some arithmetic over a
      bounded candidate set is not expensive enough to justify being wrong. If
      this ever shows up in a profile, cache the *scored candidate list* under a
      user-only key and run `diversify` per request — that is the shape that can
      be invalidated in one call.
    */
    const now = Date.now();

    /*
      A show the listener already knows is not a recommendation.

      Two exclusions, and the second one is the point. Following a show was
      already disqualifying: it is a very strong statement about taste — see
      below, where subscriptions feed the profile — and simultaneously the worst
      possible thing to put in a rail whose job is to introduce something.

      *Having played it* now disqualifies it too. That used to be handled by
      scoring, with a `DISCOVERED` demotion applied once two or more episodes
      had been heard, which left a real gap: play one episode of a show and its
      whole catalogue keeps feeding the profile — its categories, its author,
      its keywords — so it scores higher than everything around it and comes
      straight back at the top of the rail. The listener is recommended the
      thing they are in the middle of listening to, captioned as a discovery.

      One episode is enough to know a show exists, which is all this rail is for.
      `DISCOVERED` stays as the belt to this braces: it still catches a show
      reached some other way, and it is what keeps the ordering sane if this
      filter ever has to be relaxed on a thin catalogue.

      `NOT EXISTS` rather than left joins and null checks, so the planner can
      stop at the first match in each.
    */
    const candidateRows = await app.db
      .select()
      .from(podcasts)
      .where(
        sql`NOT EXISTS (
          SELECT 1 FROM ${subscriptions}
          WHERE ${subscriptions.podcastId} = ${podcasts.id}
            AND ${subscriptions.userId} = ${user.id}
        ) AND NOT EXISTS (
          SELECT 1 FROM ${playbackProgress}
          INNER JOIN ${episodes} ON ${episodes.id} = ${playbackProgress.episodeId}
          WHERE ${episodes.podcastId} = ${podcasts.id}
            AND ${playbackProgress.userId} = ${user.id}
        )`,
      )
      .orderBy(sql`${podcasts.lastPublishedAt} DESC NULLS LAST`, desc(podcasts.id))
      .limit(CANDIDATE_LIMIT);

    if (candidateRows.length === 0) return ok({ personalized: false, items: [] });

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

    /*
      How rare each category is among the shows being ranked.

      Counted here, once, rather than inside the scorer: every candidate needs
      every other candidate's tags to know what "rare" means, so this cannot be
      derived per show. See `categorySpecificity` for what it buys.
    */
    const carriers = new Map<string, number>();
    for (const candidate of candidates) {
      for (const key of new Set(candidate.categories.map(normalizeText))) {
        carriers.set(key, (carriers.get(key) ?? 0) + 1);
      }
    }

    const specificity = new Map<string, number>();
    for (const [key, count] of carriers) {
      specificity.set(key, categorySpecificity(count / candidates.length));
    }

    const scored: ScoredCandidate[] = candidates
      .map((candidate) => ({
        ...candidate,
        score: personalized
          ? recommendationScore(profile, candidate, now, specificity)
          : catalogueScore(candidate.podcast, now),
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          (b.podcast.lastPublishedAt?.getTime() ?? 0) -
            (a.podcast.lastPublishedAt?.getTime() ?? 0),
      );

    /*
      `personalized` is on the envelope, not inferred from the rows.

      A client cannot work it out for itself: this endpoint always returns a
      full rail, because a cold start falls back to catalogue quality rather
      than to an empty box. So "did this take my listening into account?" and
      "did I get any shows?" are different questions, and the UI needs the
      first one to decide between claiming the order is personal and offering
      to make it so.
    */
    const payload = {
      personalized,
      items: diversify(scored, limit).map((candidate) => ({
        ...serializePodcast(candidate.podcast, candidate.categories),
        reason: reasonFor(profile, candidate, personalized, specificity),
      })),
    };

    return ok(payload);
  });
}
