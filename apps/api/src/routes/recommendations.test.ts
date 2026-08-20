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

async function rail(limit = 10): Promise<Array<{ title: string; categories: string[] }>> {
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
});
