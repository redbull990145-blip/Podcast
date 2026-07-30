/**
 * Recommendations, computed here rather than asked of a model.
 *
 * This is deliberately plain vector maths over categories: it costs nothing to
 * run, works offline of any provider, and — the part that matters — every score
 * can be explained in a sentence that is actually true. "Because you listen to
 * a lot of Technology" is derived from the same numbers that produced the
 * ranking, not written afterwards to justify it.
 *
 * Nothing here touches the network or the database; callers supply the signals
 * and the candidate pool.
 */

export type HistoryEvent = "play_start" | "complete" | "skip" | "not_interested";

export type ListeningSignal = {
  event: HistoryEvent;
  categories: string[];
  occurredAt: Date;
};

export type SubscriptionSignal = {
  categories: string[];
  subscribedAt: Date;
};

export type Candidate = {
  feedUrl: string;
  title: string;
  author: string | null;
  artworkUrl: string | null;
  description: string | null;
  categories: string[];
  episodeCount: number | null;
  itunesId: number | null;
  podcastindexId: number | null;
};

export type Reason = {
  category: string;
  /** Plain-language sentence fragment shown on the card. */
  label: string;
};

export type Recommendation = Candidate & {
  score: number;
  reasons: Reason[];
};

/**
 * How much each interaction says about taste.
 *
 * Finishing something is the strongest positive signal available — far stronger
 * than starting it, which often just means the title looked interesting.
 * Skipping is mildly negative; an explicit "not interested" is decisive.
 */
const EVENT_WEIGHTS: Record<HistoryEvent, number> = {
  complete: 1,
  play_start: 0.35,
  skip: -0.4,
  not_interested: -1.5,
};

/** Following a show is a deliberate act, so it counts for nearly as much as finishing one. */
const SUBSCRIPTION_WEIGHT = 0.8;

/** Days after which a signal counts for half as much. Taste drifts. */
const HALF_LIFE_DAYS = 30;

const MS_PER_DAY = 86_400_000;

export type CategoryAffinity = {
  weight: number;
  completes: number;
  plays: number;
  subscriptions: number;
};

export type Affinity = Map<string, CategoryAffinity>;

function decay(occurredAt: Date, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - occurredAt.getTime()) / MS_PER_DAY);
  return 0.5 ** (ageDays / HALF_LIFE_DAYS);
}

function bucket(affinity: Affinity, category: string): CategoryAffinity {
  const existing = affinity.get(category);
  if (existing) return existing;
  const created = { weight: 0, completes: 0, plays: 0, subscriptions: 0 };
  affinity.set(category, created);
  return created;
}

/**
 * Builds a per-category taste profile from what someone has actually done.
 *
 * Counts are tracked alongside the weight purely so a recommendation can cite
 * concrete evidence ("you've finished 12 of these") instead of a number nobody
 * outside this file would understand.
 */
export function buildAffinity(
  signals: ListeningSignal[],
  subscriptions: SubscriptionSignal[],
  now: Date = new Date(),
): Affinity {
  const affinity: Affinity = new Map();

  for (const signal of signals) {
    const weight = EVENT_WEIGHTS[signal.event] * decay(signal.occurredAt, now);
    for (const category of signal.categories) {
      const entry = bucket(affinity, category);
      entry.weight += weight;
      if (signal.event === "complete") entry.completes += 1;
      if (signal.event === "play_start") entry.plays += 1;
    }
  }

  for (const subscription of subscriptions) {
    const weight = SUBSCRIPTION_WEIGHT * decay(subscription.subscribedAt, now);
    for (const category of subscription.categories) {
      const entry = bucket(affinity, category);
      entry.weight += weight;
      entry.subscriptions += 1;
    }
  }

  return affinity;
}

/**
 * Inverse document frequency across the candidate pool.
 *
 * Without this, categories that nearly every show carries — "Society & Culture"
 * and friends — would dominate every comparison and make all recommendations
 * look alike. Rare categories are what actually distinguish taste.
 */
export function inverseDocumentFrequency(candidates: Candidate[]): Map<string, number> {
  const documentFrequency = new Map<string, number>();

  for (const candidate of candidates) {
    for (const category of new Set(candidate.categories)) {
      documentFrequency.set(category, (documentFrequency.get(category) ?? 0) + 1);
    }
  }

  const total = candidates.length;
  const idf = new Map<string, number>();
  for (const [category, count] of documentFrequency) {
    idf.set(category, Math.log(1 + total / (1 + count)));
  }

  return idf;
}

/** Turns a category's evidence into something worth reading on a card. */
export function describeReason(category: string, entry: CategoryAffinity): string {
  if (entry.completes >= 2) {
    return `You've finished ${entry.completes} ${category} episodes`;
  }
  if (entry.subscriptions >= 2) {
    return `You follow ${entry.subscriptions} ${category} shows`;
  }
  if (entry.subscriptions === 1) {
    return `You follow a ${category} show`;
  }
  if (entry.completes === 1) {
    return `You finished a ${category} episode`;
  }
  return `You've been listening to ${category}`;
}

/**
 * Cosine similarity between the taste profile and one candidate, in IDF space.
 *
 * Cosine rather than a raw dot product so a show tagged with ten categories
 * cannot outrank a precise match simply by covering more ground.
 */
export function scoreCandidate(
  candidate: Candidate,
  affinity: Affinity,
  idf: Map<string, number>,
): { score: number; reasons: Reason[] } {
  const categories = [...new Set(candidate.categories)];
  if (categories.length === 0) return { score: 0, reasons: [] };

  let dot = 0;
  let candidateNorm = 0;
  const contributions: { category: string; value: number }[] = [];

  for (const category of categories) {
    const weight = idf.get(category) ?? 1;
    candidateNorm += weight * weight;

    const entry = affinity.get(category);
    if (!entry || entry.weight === 0) continue;

    const contribution = entry.weight * weight * weight;
    dot += contribution;
    if (contribution > 0) contributions.push({ category, value: contribution });
  }

  let affinityNorm = 0;
  for (const [category, entry] of affinity) {
    const weight = idf.get(category) ?? 1;
    affinityNorm += (entry.weight * weight) ** 2;
  }

  if (candidateNorm === 0 || affinityNorm === 0) return { score: 0, reasons: [] };

  const score = dot / (Math.sqrt(candidateNorm) * Math.sqrt(affinityNorm));

  const reasons = contributions
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map(({ category }) => ({
      category,
      label: describeReason(category, affinity.get(category)!),
    }));

  return { score, reasons };
}

/**
 * Ranks candidates, dropping anything already followed or explicitly rejected.
 *
 * Popularity is used only to break ties, never as a driver — "everyone else
 * listens to this" is exactly the recommendation people complain about.
 */
export function rankCandidates(input: {
  candidates: Candidate[];
  affinity: Affinity;
  excludeFeedUrls?: Iterable<string>;
  limit?: number;
}): Recommendation[] {
  const { candidates, affinity, excludeFeedUrls, limit = 12 } = input;

  const excluded = new Set(
    [...(excludeFeedUrls ?? [])].map((url) => url.trim().toLowerCase()),
  );

  const pool = candidates.filter(
    (c) => !excluded.has(c.feedUrl.trim().toLowerCase()),
  );

  // IDF is computed over the candidate pool, so it reflects how distinctive a
  // category is among the shows actually being compared.
  const idf = inverseDocumentFrequency(pool);

  const scored = pool
    .map((candidate) => {
      const { score, reasons } = scoreCandidate(candidate, affinity, idf);
      return { ...candidate, score, reasons };
    })
    .filter((r) => r.score > 0 && r.reasons.length > 0);

  scored.sort(
    (a, b) => b.score - a.score || (b.episodeCount ?? 0) - (a.episodeCount ?? 0),
  );

  return scored.slice(0, limit);
}

/** The categories worth searching for more of, strongest first. */
export function topCategories(affinity: Affinity, limit = 5): string[] {
  return [...affinity.entries()]
    .filter(([, entry]) => entry.weight > 0)
    .sort((a, b) => b[1].weight - a[1].weight)
    .slice(0, limit)
    .map(([category]) => category);
}
