/**
 * Personalised recommendations, through the real HTTP layer and a real Postgres.
 *
 * The thing worth testing is not that the scorer arithmetic runs — it is that
 * listening to one kind of show changes what comes back, and that the failure
 * modes are boring. So every case here drives the endpoint the way a client
 * does: sign up, play some episodes over the real progress route, then read the
 * rail and look at what is on top.
 *
 * Signals are written through `PUT /me/progress/:id` and `PUT
 * /me/subscriptions/:id` rather than inserted directly, because a
 * recommendation built from rows no client can actually produce is a
 * recommendation for a different app.
 */

import { categories, episodes, podcastCategories, podcasts } from '@cue/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.ts';
import { buildServer } from '../server.ts';

let app: FastifyInstance;
let cookie: string;

/** podcast title → id, and podcast title → its episode ids in publication order. */
const showIds = new Map<string, string>();
const episodeIds = new Map<string, string[]>();

/**
 * The fixture catalogue, newest first — and stacked against the answer.
 *
 * Every show carries the same episode count, artwork and source, so the only
 * thing separating them without a listener is how recently they published. The
 * self-improvement shelf is deliberately the *oldest* part of the catalogue,
 * which means a cold rail never contains it. Every test that claims listening
 * to motivation surfaces motivation is therefore claiming the personal signal
 * beat the ordering, rather than agreeing with it by luck — which is the only
 * version of that assertion worth writing.
 *
 * The dates are a day apart, so freshness separates the shows into a stable
 * order while contributing well under a point of score. Personal signal, when
 * there is any, is worth tens.
 */
const CATALOGUE: Array<{
  title: string;
  author: string | null;
  category: string | null;
  daysAgo: number;
}> = [
  { title: 'Silicon Notes', author: 'Wei Chen', category: 'Technology', daysAgo: 0 },
  { title: 'The Long Laugh', author: 'Bex Hart', category: 'Comedy', daysAgo: 1 },
  { title: 'Two Idiots Talking', author: 'Sam Roy', category: 'Comedy', daysAgo: 2 },
  { title: 'Founder Diaries', author: 'Priya Nair', category: 'Business', daysAgo: 3 },
  { title: 'Margin Call', author: 'Dana Okoro', category: 'Business', daysAgo: 4 },
  /*
    A third business show, and the oldest thing in the catalogue.

    Needed because a show the listener has played is no longer a candidate at
    all, so a test that establishes interest in a category by *listening to
    every show in it* would leave that category with nothing left to rank. Two
    per category was only ever enough while heard shows stayed in the running.

    Deliberately last by recency, so freshness pulls against it: if it still
    outranks a comedy show published nine days later, the category signal is
    what put it there rather than the catalogue score.
  */
  { title: 'Balance Sheet', author: 'Ivo Marek', category: 'Business', daysAgo: 10 },
  // Deliberately untagged and unattributed. A feed like this is common in the
  // wild and must not be able to take the endpoint down with it.
  { title: 'An Untagged Show', author: null, category: null, daysAgo: 5 },
  { title: 'Daily Motivation', author: 'Coach Reed', category: 'Self Improvement', daysAgo: 6 },
  { title: 'Morning Momentum', author: 'Ana Vale', category: 'Self Improvement', daysAgo: 7 },
  { title: 'Mindset Mastery', author: 'Coach Reed', category: 'Self Improvement', daysAgo: 8 },
  { title: 'Quiet Discipline', author: 'Tomas Iyer', category: 'Self Improvement', daysAgo: 9 },
];

async function signUp(email: string): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/sign-up/email',
    payload: { email, password: 'correct-horse-battery', name: 'Listener' },
  });

  const setCookie = response.headers['set-cookie'];
  return (Array.isArray(setCookie) ? setCookie : [setCookie ?? ''])
    .map((entry) => String(entry).split(';')[0])
    .join('; ');
}

/** Play an episode of a show to a given fraction, as a client would report it. */
async function listen(
  title: string,
  options: { fraction?: number; completed?: boolean; episode?: number } = {},
): Promise<void> {
  const index = options.episode ?? 0;

  const response = await app.inject({
    method: 'PUT',
    url: `/me/progress/${episodeIds.get(title)![index]}`,
    headers: { cookie },
    payload: {
      positionSec: Math.round(3600 * (options.fraction ?? 0.9)),
      durationSec: 3600,
      completed: options.completed ?? true,
      deviceId: 'test-device',
    },
  });

  expect(response.statusCode).toBe(200);
}

async function follow(title: string): Promise<void> {
  const response = await app.inject({
    method: 'PUT',
    url: `/me/subscriptions/${showIds.get(title)}`,
    headers: { cookie },
  });

  expect(response.statusCode).toBe(200);
}

async function rail(
  limit = 10,
): Promise<
  Array<{
    title: string;
    categories: string[];
    reason: { kind: string; subject: string | null };
  }>
> {
  const response = await app.inject({
    method: 'GET',
    url: `/me/recommendations?limit=${limit}`,
    headers: { cookie },
  });

  expect(response.statusCode).toBe(200);
  return response.json().data.items;
}

const titlesOf = (items: Array<{ title: string }>) => items.map((item) => item.title);

beforeAll(async () => {
  app = await buildServer(
    loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'pglite://memory',
      CORS_ORIGINS: 'http://localhost:3000',
    }),
  );
  await app.ready();

  const categoryIds = new Map<string, number>();
  for (const name of ['Self Improvement', 'Business', 'Comedy', 'Technology']) {
    const [row] = await app.db
      .insert(categories)
      .values({ slug: name.toLowerCase().replace(/\W+/g, '-'), name })
      .returning({ id: categories.id });
    categoryIds.set(name, row!.id);
  }

  for (const show of CATALOGUE) {
    // Relative to now rather than a fixed date, because both freshness and the
    // recency decay on listening are measured against the clock. Pinning the
    // catalogue to a calendar date would make these tests quietly change
    // meaning as they aged.
    const published = new Date(Date.now() - show.daysAgo * 86_400_000);

    const [row] = await app.db
      .insert(podcasts)
      .values({
        feedUrl: `https://example.com/${show.title.toLowerCase().replace(/\W+/g, '-')}.xml`,
        title: show.title,
        author: show.author,
        description: `${show.title}, a show about ${show.category ?? 'things'}.`,
        artworkUrl: 'https://example.com/art.jpg',
        episodeCount: 100,
        lastPublishedAt: published,
      })
      .returning({ id: podcasts.id });

    showIds.set(show.title, row!.id);

    if (show.category) {
      await app.db.insert(podcastCategories).values({
        podcastId: row!.id,
        categoryId: categoryIds.get(show.category)!,
      });
    }

    // Two episodes each, so "heard more than one of these" is expressible.
    const inserted = await app.db
      .insert(episodes)
      .values([
        {
          podcastId: row!.id,
          guid: `${show.title}-1`,
          title: `${show.title} one`,
          audioUrl: 'https://cdn.example.com/1.mp3',
          publishedAt: published,
          durationSec: 3600,
        },
        {
          podcastId: row!.id,
          guid: `${show.title}-2`,
          title: `${show.title} two`,
          audioUrl: 'https://cdn.example.com/2.mp3',
          publishedAt: published,
          durationSec: 3600,
        },
      ])
      .returning({ id: episodes.id });

    episodeIds.set(
      show.title,
      inserted.map((row) => row.id),
    );
  }
});

/*
  A new account per test.

  Everything this endpoint reads is user-scoped, so a fresh sign-up is a
  cheaper and more honest reset than truncating the tables — and it means each
  test starts from the cold-start state a real new listener starts from.
*/
beforeEach(async () => {
  cookie = await signUp(`listener-${Math.random().toString(36).slice(2)}@example.com`);
});

afterAll(async () => {
  await app.close();
});

describe('recommendations', () => {
  it('refuses anonymous callers, like every other /me route', async () => {
    const response = await app.inject({ method: 'GET', url: '/me/recommendations' });
    expect(response.statusCode).toBe(401);
  });

  /**
   * The cold start. An account with no history must not get an empty rail —
   * that is the state where a Recommended section is most visible and least
   * excusable, because it is the first thing a new listener ever sees.
   */
  it('gives a brand-new listener a full rail rather than an empty one', async () => {
    const items = await rail();
    expect(items.length).toBeGreaterThan(0);
  });

  /**
   * The core claim. Finish episodes of one motivational show and the rest of
   * that shelf should come up — not because the category was matched by name,
   * but because it is the category the listener's own behaviour points at.
   */
  it('learns a category from what was actually finished', async () => {
    // The shelf is the oldest part of the catalogue, so a cold rail of four
    // cannot contain any of it. Establishing that first is what turns the
    // second half of this test into evidence.
    const cold = await rail(4);
    expect(cold.some((item) => item.categories.includes('Self Improvement'))).toBe(false);

    await listen('Daily Motivation', { completed: true });
    await listen('Daily Motivation', { completed: true, episode: 1 });

    const warm = await rail(4);
    const shelf = warm.filter((item) => item.categories.includes('Self Improvement'));

    expect(shelf.length).toBeGreaterThanOrEqual(2);
  });

  it('ranks the learned category above one the listener has ignored', async () => {
    await listen('Founder Diaries', { completed: true });
    await listen('Margin Call', { completed: true });

    const items = await rail(10);
    const business = items.findIndex((item) => item.categories.includes('Business'));
    const comedy = items.findIndex((item) => item.categories.includes('Comedy'));

    expect(business).toBeGreaterThanOrEqual(0);
    expect(business).toBeLessThan(comedy);
  });

  /**
   * Not every play means the same thing. Somebody who abandons a show after
   * ninety seconds has told us something, and it is not "more of this" — so a
   * near-complete listen in one category has to outrank a bounced one in
   * another.
   */
  it('weighs a finished episode above one that was abandoned early', async () => {
    // The abandoned show is the *newer* one, so freshness is pulling the other
    // way. If a bounce counted the same as a finish, comedy would win on the
    // catalogue score alone.
    await listen('Margin Call', { completed: true });
    await listen('The Long Laugh', { fraction: 0.02, completed: false });

    const items = await rail(10);
    const business = items.findIndex((item) => item.categories.includes('Business'));
    const comedy = items.findIndex((item) => item.categories.includes('Comedy'));

    expect(business).toBeLessThan(comedy);
  });

  /**
   * Following a show is the loudest signal available and simultaneously the
   * strongest reason not to recommend that particular show: it is already in
   * the listener's library, and a rail whose job is to introduce something
   * should not spend a slot re-introducing it.
   */
  it('takes a followed show out of the rail while keeping its taste', async () => {
    await follow('Daily Motivation');

    const items = await rail(10);

    expect(titlesOf(items)).not.toContain('Daily Motivation');
    expect(items.some((item) => item.categories.includes('Self Improvement'))).toBe(true);
  });

  /**
   * A rail that is eighteen copies of one shelf is not personalisation, it is a
   * filter bubble with a heading. The cap lets the dominant interest dominate
   * and stops it owning the whole thing.
   */
  it('does not let one category fill the entire rail', async () => {
    await listen('Daily Motivation', { completed: true });
    await listen('Morning Momentum', { completed: true });
    await listen('Mindset Mastery', { completed: true });

    const items = await rail(6);
    const shelf = items.filter((item) => item.categories.includes('Self Improvement'));

    expect(shelf.length).toBeLessThan(items.length);
  });

  /**
   * One listen is a data point, not a taste. The threshold exists so that
   * somebody who has opened a single comedy episode is not handed a wall of
   * comedy — and so nobody gets permanently classified by their first tap.
   */
  it('does not rebuild the whole rail around a single brief play', async () => {
    const cold = titlesOf(await rail(6));

    await listen('Quiet Discipline', { fraction: 0.01, completed: false });

    // Byte-for-byte the same rail. A ten-second sample of the oldest show in
    // the catalogue is not a taste, and the strongest way to say so is that the
    // ranking did not move at all.
    expect(titlesOf(await rail(6))).toEqual(cold);
  });

  /**
   * A show with no category and no author is thin, not broken. It has to score
   * — badly, probably — rather than throw, because one malformed feed taking
   * out the home screen is the failure mode this whole endpoint is most
   * exposed to.
   */
  it('scores a show with no category and no author without falling over', async () => {
    await listen('Silicon Notes', { completed: true });

    const items = await rail(10);
    expect(titlesOf(items)).toContain('An Untagged Show');
  });

  it('never returns a show twice, however many categories it carries', async () => {
    await listen('Daily Motivation', { completed: true });

    const returned = titlesOf(await rail(10));
    expect(new Set(returned).size).toBe(returned.length);
  });

  it('honours the limit', async () => {
    expect(await rail(3)).toHaveLength(3);
  });

  /**
   * The regression that only showed up in a running app.
   *
   * Finishing two episodes of a show is the strongest possible signal about
   * its category *and* its host, so the same listening that marks a show as
   * already-discovered also piles score onto it. With a tuned deduction the
   * show somebody had just finished came back as their top recommendation,
   * captioned "More from" its own host — the least useful suggestion the
   * system is capable of making.
   *
   * It is now excluded outright rather than demoted, and at *any* depth. The
   * demotion version left it reappearing once the unheard shows ran out, on the
   * reasoning that a short rail is worse than a repetitive one — which is true
   * of a rail padded with popular shows and false of one padded with the show
   * you are in the middle of. A recommendation is an introduction; there is no
   * page depth at which introducing somebody to a show they have played is
   * useful.
   */
  it('does not recommend a show the listener has played, at any depth', async () => {
    await listen('Daily Motivation', { completed: true });
    await listen('Daily Motivation', { completed: true, episode: 1 });

    expect(titlesOf(await rail(4))).not.toContain('Daily Motivation');
    expect(titlesOf(await rail(10))).not.toContain('Daily Motivation');
  });

  /**
   * One episode is enough to know a show exists.
   *
   * The old rule needed two before it did anything, which meant the single most
   * likely thing to be recommended to somebody was whatever they had started
   * that afternoon: one play is enough to load the profile with that show's
   * category, host and keywords, and nowhere near enough to disqualify it.
   */
  it('drops a show after a single play, not two', async () => {
    await listen('Morning Momentum', { fraction: 0.1, completed: false });

    expect(titlesOf(await rail(10))).not.toContain('Morning Momentum');
  });

  /**
   * Excluding is only safe if the rail still fills.
   *
   * A filter that empties the shelf is a worse failure than the repetition it
   * replaced, and the catalogue behind a young account is small.
   */
  it('still fills the rail once several shows are excluded', async () => {
    await listen('Daily Motivation', { completed: true });
    await listen('Margin Call', { completed: true });
    await follow('The Long Laugh');

    const titles = titlesOf(await rail(4));

    expect(titles).toHaveLength(4);
    expect(titles).not.toContain('Daily Motivation');
    expect(titles).not.toContain('Margin Call');
    expect(titles).not.toContain('The Long Laugh');
  });

  /**
   * The caption under every card.
   *
   * A rail of covers with no explanation is indistinguishable from a rail of
   * random covers, so the reason is part of the contract rather than something
   * the client reconstructs. These check the two halves that can go wrong: that
   * a real connection is named, and that an absent one is admitted to.
   */
  it('tells a new listener the rail is not personalised', async () => {
    const items = await rail(4);
    expect(items.every((item) => item.reason.kind === 'popular')).toBe(true);
  });

  it('names the category it learned', async () => {
    await listen('Daily Motivation', { completed: true });
    await listen('Daily Motivation', { completed: true, episode: 1 });

    // Ana Vale is a stranger to this listener, so the shelf is the only
    // connection there is and the caption has to be the category. Asserting on
    // a named show rather than on whatever sorted first matters here: half the
    // self-improvement shelf shares an author with what was played, and those
    // are captioned by creator on purpose.
    const [match] = (await rail(10)).filter((item) => item.title === 'Morning Momentum');

    expect(match).toBeDefined();
    expect(match!.reason).toEqual({ kind: 'category', subject: 'Self Improvement' });
  });

  /**
   * Following one show by a creator is a statement about the creator, and the
   * caption should say so rather than falling back to their category — which
   * is the weaker claim of the two here.
   */
  it('names the creator when the creator is the connection', async () => {
    // 'Coach Reed' makes both Daily Motivation and Mindset Mastery, and only
    // the second is a candidate once the first is followed.
    await follow('Daily Motivation');

    const [match] = (await rail(10)).filter((item) => item.title === 'Mindset Mastery');

    expect(match).toBeDefined();
    expect(match!.reason.kind).toBe('creator');
    expect(match!.reason.subject).toBe('Coach Reed');
  });

  /**
   * The failure this guards against is captioned personalisation: a show that
   * won on catalogue quality alone being labelled "More in Comedy" for someone
   * who has never played a comedy episode.
   */
  it('never invents a connection for a show that has none', async () => {
    await listen('Daily Motivation', { completed: true });
    await listen('Daily Motivation', { completed: true, episode: 1 });

    for (const item of await rail(10)) {
      if (item.reason.kind === 'category') {
        expect(item.categories).toContain(item.reason.subject);
      }
    }
  });
});
