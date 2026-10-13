/**
 * Playlists, through the real HTTP layer and a real Postgres.
 *
 * Two things here cannot be checked by calling a function. One is ownership:
 * a playlist id travels in the URL, so every item route has to prove the
 * playlist is the caller's before it touches anything — and the failure mode is
 * silent, since writing to somebody else's playlist looks exactly like success.
 * The other is ordering, which is fractional keys and SQL collation working
 * together; either alone can be right while the pair is wrong.
 */

import { episodes, podcasts } from '@cue/db';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.ts';
import { buildServer } from '../server.ts';

let app: FastifyInstance;
let cookie: string;
let episodeIds: string[];
let showId: string;
let otherShowId: string;
/** A real show that is never added to anything, for the stale-reorder case. */
let strangerShowId: string;

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

async function createPlaylist(title = 'Long drives', as: string = cookie): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/me/playlists',
    headers: { origin: app.config.corsOrigins[0], cookie: as },
    payload: { title, kind: 'episode' },
  });

  return response.json().data.playlist.id as string;
}

/** The other kind. Shows go in these; episodes are refused. */
async function createShowPlaylist(title = 'Meaning to start'): Promise<string> {
  const response = await app.inject({
    method: 'POST',
    url: '/me/playlists',
    headers: { origin: app.config.corsOrigins[0], cookie },
    payload: { title, kind: 'podcast' },
  });

  return response.json().data.playlist.id as string;
}

function addShow(playlistId: string, podcastId: string, position?: 'start' | 'end') {
  return app.inject({
    method: 'POST',
    url: `/me/playlists/${playlistId}/podcasts`,
    headers: { origin: app.config.corsOrigins[0], cookie },
    payload: position ? { podcastId, position } : { podcastId },
  });
}

async function showOrderOf(playlistId: string): Promise<string[]> {
  const response = await app.inject({
    method: 'GET',
    url: `/me/playlists/${playlistId}`,
    headers: { origin: app.config.corsOrigins[0], cookie },
  });

  return response
    .json()
    .data.playlist.podcasts.map((item: { podcast: { id: string } }) => item.podcast.id);
}

function addEpisode(playlistId: string, episodeId: string, position?: 'start' | 'end') {
  return app.inject({
    method: 'POST',
    url: `/me/playlists/${playlistId}/items`,
    headers: { origin: app.config.corsOrigins[0], cookie },
    payload: position ? { episodeId, position } : { episodeId },
  });
}

async function orderOf(playlistId: string): Promise<string[]> {
  const response = await app.inject({
    method: 'GET',
    url: `/me/playlists/${playlistId}`,
    headers: { origin: app.config.corsOrigins[0], cookie },
  });

  return response
    .json()
    .data.playlist.items.map((item: { episode: { id: string } }) => item.episode.id);
}

beforeAll(async () => {
  app = await buildServer(
    loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'pglite://memory',
      CORS_ORIGINS: 'http://localhost:3000',
    }),
  );
  await app.ready();

  const [show] = await app.db
    .insert(podcasts)
    .values({
      feedUrl: 'https://example.com/playlists.xml',
      title: 'Playlist Show',
      artworkUrl: 'https://cdn.example.com/show.jpg',
    })
    .returning({ id: podcasts.id });

  showId = show!.id;

  const [second, third] = await app.db
    .insert(podcasts)
    .values([
      { feedUrl: 'https://example.com/other.xml', title: 'Other Show' },
      { feedUrl: 'https://example.com/stranger.xml', title: 'Stranger Show' },
    ])
    .returning({ id: podcasts.id });

  otherShowId = second!.id;
  strangerShowId = third!.id;

  const rows = await app.db
    .insert(episodes)
    .values(
      [1, 2, 3, 4, 5].map((n) => ({
        podcastId: show!.id,
        guid: `pl-ep-${n}`,
        title: `Episode ${n}`,
        audioUrl: `https://cdn.example.com/pl-${n}.mp3`,
        publishedAt: new Date(),
        durationSec: 600 * n,
        // Only some episodes carry their own art, so the cover stack has to
        // fall back to the show's for the rest.
        artworkUrl: n % 2 === 0 ? `https://cdn.example.com/ep-${n}.jpg` : null,
      })),
    )
    .returning({ id: episodes.id });

  episodeIds = rows.map((row) => row.id);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  cookie = await signUp(`curator-${Math.random().toString(36).slice(2)}@example.com`);
});

describe('creating and listing', () => {
  it('refuses anonymous callers', async () => {
    const response = await app.inject({ method: 'GET', url: '/me/playlists' });
    expect(response.statusCode).toBe(401);
  });

  it('creates a playlist and returns it', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/me/playlists',
      headers: { origin: app.config.corsOrigins[0], cookie },
      payload: { title: '  Long drives  ', kind: 'episode', description: 'For the M6' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data.playlist).toMatchObject({
      // Trimmed by the shared schema, so the client and server agree.
      title: 'Long drives',
      description: 'For the M6',
      itemCount: 0,
      artworkUrls: [],
    });
  });

  it('rejects a nameless playlist', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/me/playlists',
      headers: { origin: app.config.corsOrigins[0], cookie },
      payload: { title: '   ' },
    });

    // `bad_request`, which this API maps to 400 — there is no 422 in its
    // error vocabulary, and a field-addressed message rides along in `fields`.
    expect(response.statusCode).toBe(400);
    expect(response.json().error.fields).toHaveProperty('title');
  });

  it('treats an empty description as no description', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/me/playlists',
      headers: { origin: app.config.corsOrigins[0], cookie },
      payload: { title: 'Untitled', kind: 'episode', description: '' },
    });

    expect(response.json().data.playlist.description).toBeNull();
  });

  it('lists only the caller’s own playlists', async () => {
    const stranger = await signUp(`stranger-${Math.random().toString(36).slice(2)}@example.com`);
    await createPlaylist('Theirs', stranger);
    await createPlaylist('Mine');

    const response = await app.inject({
      method: 'GET',
      url: '/me/playlists',
      headers: { origin: app.config.corsOrigins[0], cookie },
    });

    expect(response.json().data.items.map((p: { title: string }) => p.title)).toEqual(['Mine']);
  });

  it('counts episodes and stacks covers, falling back to the show’s art', async () => {
    const id = await createPlaylist();
    for (const episodeId of episodeIds.slice(0, 3)) await addEpisode(id, episodeId);

    const response = await app.inject({
      method: 'GET',
      url: '/me/playlists',
      headers: { origin: app.config.corsOrigins[0], cookie },
    });

    const playlist = response.json().data.items[0];
    expect(playlist.itemCount).toBe(3);
    expect(playlist.artworkUrls).toEqual([
      'https://cdn.example.com/show.jpg',
      'https://cdn.example.com/ep-2.jpg',
      'https://cdn.example.com/show.jpg',
    ]);
  });

  it('stacks at most four covers however long the playlist is', async () => {
    const id = await createPlaylist();
    for (const episodeId of episodeIds) await addEpisode(id, episodeId);

    const response = await app.inject({
      method: 'GET',
      url: '/me/playlists',
      headers: { origin: app.config.corsOrigins[0], cookie },
    });

    expect(response.json().data.items[0].artworkUrls).toHaveLength(4);
    expect(response.json().data.items[0].itemCount).toBe(5);
  });

  it('sorts by what was last touched, contents included', async () => {
    const older = await createPlaylist('Older');
    const newer = await createPlaylist('Newer');

    // Adding to the older one makes it the most recently used, which is what
    // someone means when they go looking for a playlist.
    await addEpisode(older, episodeIds[0]!);

    const response = await app.inject({
      method: 'GET',
      url: '/me/playlists',
      headers: { origin: app.config.corsOrigins[0], cookie },
    });

    expect(response.json().data.items.map((p: { id: string }) => p.id)).toEqual([older, newer]);
  });
});

describe('ownership', () => {
  it('hides a stranger’s playlist behind a 404 rather than a 403', async () => {
    // A distinct "exists but not yours" would turn the id space into an oracle.
    const stranger = await signUp(`stranger-${Math.random().toString(36).slice(2)}@example.com`);
    const theirs = await createPlaylist('Theirs', stranger);

    const read = await app.inject({
      method: 'GET',
      url: `/me/playlists/${theirs}`,
      headers: { origin: app.config.corsOrigins[0], cookie },
    });

    expect(read.statusCode).toBe(404);
  });

  it('refuses to add an episode to a stranger’s playlist', async () => {
    const stranger = await signUp(`stranger-${Math.random().toString(36).slice(2)}@example.com`);
    const theirs = await createPlaylist('Theirs', stranger);

    const response = await addEpisode(theirs, episodeIds[0]!);
    expect(response.statusCode).toBe(404);

    // And nothing was written: the failure has to be a refusal, not a partial.
    const read = await app.inject({
      method: 'GET',
      url: `/me/playlists/${theirs}`,
      headers: { origin: app.config.corsOrigins[0], cookie: stranger },
    });
    expect(read.json().data.playlist.items).toEqual([]);
  });

  it('refuses to rename a stranger’s playlist', async () => {
    const stranger = await signUp(`stranger-${Math.random().toString(36).slice(2)}@example.com`);
    const theirs = await createPlaylist('Theirs', stranger);

    const response = await app.inject({
      method: 'PATCH',
      url: `/me/playlists/${theirs}`,
      headers: { origin: app.config.corsOrigins[0], cookie },
      payload: { title: 'Mine now' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('leaves a stranger’s playlist alone on delete', async () => {
    const stranger = await signUp(`stranger-${Math.random().toString(36).slice(2)}@example.com`);
    const theirs = await createPlaylist('Theirs', stranger);

    // Deleting what is not yours deletes nothing and reports success, which is
    // the same answer as deleting something already gone — so this cannot be
    // used to discover whether an id exists.
    const response = await app.inject({
      method: 'DELETE',
      url: `/me/playlists/${theirs}`,
      headers: { origin: app.config.corsOrigins[0], cookie },
    });
    expect(response.statusCode).toBe(200);

    const read = await app.inject({
      method: 'GET',
      url: `/me/playlists/${theirs}`,
      headers: { origin: app.config.corsOrigins[0], cookie: stranger },
    });
    expect(read.statusCode).toBe(200);
  });
});

describe('items', () => {
  it('appends by default and prepends on request', async () => {
    const id = await createPlaylist();

    await addEpisode(id, episodeIds[0]!);
    await addEpisode(id, episodeIds[1]!);
    await addEpisode(id, episodeIds[2]!, 'start');

    expect(await orderOf(id)).toEqual([episodeIds[2], episodeIds[0], episodeIds[1]]);
  });

  it('treats adding the same episode twice as success, not a duplicate', async () => {
    const id = await createPlaylist();

    await addEpisode(id, episodeIds[0]!);
    const second = await addEpisode(id, episodeIds[0]!);

    expect(second.statusCode).toBe(200);
    expect(await orderOf(id)).toEqual([episodeIds[0]]);
  });

  it('404s an episode that does not exist', async () => {
    const id = await createPlaylist();
    const response = await addEpisode(id, '00000000-0000-4000-8000-000000000000');

    expect(response.statusCode).toBe(404);
  });

  it('removes an episode, and removing it again is still success', async () => {
    const id = await createPlaylist();
    await addEpisode(id, episodeIds[0]!);

    for (const _ of [1, 2]) {
      const response = await app.inject({
        method: 'DELETE',
        url: `/me/playlists/${id}/items/${episodeIds[0]}`,
        headers: { origin: app.config.corsOrigins[0], cookie },
      });
      expect(response.statusCode).toBe(200);
    }

    expect(await orderOf(id)).toEqual([]);
  });

  it('reorders to exactly the order it was given', async () => {
    const id = await createPlaylist();
    for (const episodeId of episodeIds.slice(0, 4)) await addEpisode(id, episodeId);

    const reversed = [...episodeIds.slice(0, 4)].reverse();

    const response = await app.inject({
      method: 'PUT',
      url: `/me/playlists/${id}/order`,
      headers: { origin: app.config.corsOrigins[0], cookie },
      payload: { episodeIds: reversed },
    });

    expect(response.json().data.reordered).toBe(4);
    expect(await orderOf(id)).toEqual(reversed);
  });

  it('ignores ids that are not in the playlist rather than failing', async () => {
    // An order computed against a slightly stale list is the normal case on two
    // devices, not an error worth rejecting the whole reorder for.
    const id = await createPlaylist();
    await addEpisode(id, episodeIds[0]!);
    await addEpisode(id, episodeIds[1]!);

    const response = await app.inject({
      method: 'PUT',
      url: `/me/playlists/${id}/order`,
      headers: { origin: app.config.corsOrigins[0], cookie },
      payload: { episodeIds: [episodeIds[1], episodeIds[4], episodeIds[0]] },
    });

    expect(response.json().data.reordered).toBe(2);
    expect(await orderOf(id)).toEqual([episodeIds[1], episodeIds[0]]);
  });

  it('reports which playlists already hold an episode', async () => {
    const withIt = await createPlaylist('Has it');
    const withoutIt = await createPlaylist('Does not');
    await addEpisode(withIt, episodeIds[0]!);

    const response = await app.inject({
      method: 'GET',
      url: `/me/playlists/containing/${episodeIds[0]}`,
      headers: { origin: app.config.corsOrigins[0], cookie },
    });

    expect(response.json().data.playlistIds).toEqual([withIt]);
    expect(response.json().data.playlistIds).not.toContain(withoutIt);
  });

  it('does not report a stranger’s playlist as containing the episode', async () => {
    const stranger = await signUp(`stranger-${Math.random().toString(36).slice(2)}@example.com`);
    const theirs = await createPlaylist('Theirs', stranger);
    await app.inject({
      method: 'POST',
      url: `/me/playlists/${theirs}/items`,
      headers: { origin: app.config.corsOrigins[0], cookie: stranger },
      payload: { episodeId: episodeIds[0] },
    });

    const response = await app.inject({
      method: 'GET',
      url: `/me/playlists/containing/${episodeIds[0]}`,
      headers: { origin: app.config.corsOrigins[0], cookie },
    });

    expect(response.json().data.playlistIds).toEqual([]);
  });
});

describe('editing', () => {
  it('renames without touching the description', async () => {
    const id = await createPlaylist();
    await app.inject({
      method: 'PATCH',
      url: `/me/playlists/${id}`,
      headers: { origin: app.config.corsOrigins[0], cookie },
      payload: { description: 'For the M6' },
    });

    const response = await app.inject({
      method: 'PATCH',
      url: `/me/playlists/${id}`,
      headers: { origin: app.config.corsOrigins[0], cookie },
      payload: { title: 'Short hops' },
    });

    expect(response.json().data.playlist).toMatchObject({
      title: 'Short hops',
      description: 'For the M6',
    });
  });

  it('rejects an empty patch rather than pretending to change something', async () => {
    const id = await createPlaylist();
    const response = await app.inject({
      method: 'PATCH',
      url: `/me/playlists/${id}`,
      headers: { origin: app.config.corsOrigins[0], cookie },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it('deletes the playlist and its contents', async () => {
    const id = await createPlaylist();
    await addEpisode(id, episodeIds[0]!);

    await app.inject({ method: 'DELETE', url: `/me/playlists/${id}`, headers: { origin: app.config.corsOrigins[0], cookie } });

    const read = await app.inject({
      method: 'GET',
      url: `/me/playlists/${id}`,
      headers: { origin: app.config.corsOrigins[0], cookie },
    });
    expect(read.statusCode).toBe(404);

    // The episode itself survives — a playlist holds references, not episodes.
    const episode = await app.inject({ method: 'GET', url: `/episodes/${episodeIds[0]}` });
    expect(episode.statusCode).toBe(200);
  });
});

/**
 * The kind boundary.
 *
 * This is the one rule that is a *product* decision rather than a data one, and
 * the one most likely to be quietly broken by a later refactor: both add routes
 * look almost identical, so it is easy to fix a bug in one and leave the other
 * accepting anything. Both directions are asserted for that reason.
 */
describe('what a playlist will hold', () => {
  it('refuses a show in an episode playlist, and says what would have taken it', async () => {
    const playlistId = await createPlaylist();

    const response = await addShow(playlistId, showId);

    expect(response.statusCode).toBe(409);
    // The client turns exactly this into an offer to make a show playlist. It
    // matches on the fields, never on the prose — so the fields are the contract.
    expect(response.json().error).toMatchObject({
      code: 'conflict',
      fields: { kind: 'episode', expected: 'podcast' },
    });
  });

  it('refuses an episode in a show playlist', async () => {
    const playlistId = await createShowPlaylist();

    const response = await addEpisode(playlistId, episodeIds[0]!);

    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatchObject({
      code: 'conflict',
      fields: { kind: 'podcast', expected: 'episode' },
    });
  });

  it('will not let the kind be edited out from under the items', async () => {
    const playlistId = await createPlaylist();

    const response = await app.inject({
      method: 'PATCH',
      url: `/me/playlists/${playlistId}`,
      headers: { origin: app.config.corsOrigins[0], cookie },
      // `kind` is not in the update schema at all, so this is an empty patch —
      // which is refused rather than silently succeeding at nothing.
      payload: { kind: 'podcast' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('lists only the kind that was asked for', async () => {
    await createPlaylist('Episodes one');
    await createShowPlaylist('Shows one');

    const shows = await app.inject({
      method: 'GET',
      url: '/me/playlists?kind=podcast',
      headers: { origin: app.config.corsOrigins[0], cookie },
    });

    const items = shows.json().data.items as { title: string; kind: string }[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'Shows one', kind: 'podcast' });
  });
});

describe('shows in a show playlist', () => {
  it('adds a show, counts it, and takes its cover for the tile', async () => {
    const playlistId = await createShowPlaylist();

    expect((await addShow(playlistId, showId)).statusCode).toBe(200);

    const response = await app.inject({
      method: 'GET',
      url: `/me/playlists/${playlistId}`,
      headers: { origin: app.config.corsOrigins[0], cookie },
    });

    const playlist = response.json().data.playlist;
    // `itemCount` counts shows here, not episodes — the field means whatever
    // the playlist holds, which is the reason there is only one of it.
    expect(playlist.itemCount).toBe(1);
    expect(playlist.artworkUrls).toEqual(['https://cdn.example.com/show.jpg']);
    expect(playlist.podcasts[0].podcast.id).toBe(showId);
    expect(playlist.items).toEqual([]);
  });

  it('holds a show once however many times it is added', async () => {
    const playlistId = await createShowPlaylist();

    await addShow(playlistId, showId);
    await addShow(playlistId, showId);

    expect(await showOrderOf(playlistId)).toEqual([showId]);
  });

  it('reorders shows, and ignores ids that are not in the playlist', async () => {
    const playlistId = await createShowPlaylist();

    await addShow(playlistId, showId);
    await addShow(playlistId, otherShowId);

    expect(await showOrderOf(playlistId)).toEqual([showId, otherShowId]);

    const response = await app.inject({
      method: 'PUT',
      url: `/me/playlists/${playlistId}/podcasts/order`,
      headers: { origin: app.config.corsOrigins[0], cookie },
      // A stale order computed against a list that has since changed is the
      // normal case, not an error — the unknown id is dropped, not rejected.
      payload: { podcastIds: [otherShowId, showId, strangerShowId] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.reordered).toBe(2);
    expect(await showOrderOf(playlistId)).toEqual([otherShowId, showId]);
  });

  it('refuses to touch a stranger playlist', async () => {
    const strangerCookie = await signUp(`stranger-${Math.random().toString(36).slice(2)}@x.com`);
    const theirs = await app.inject({
      method: 'POST',
      url: '/me/playlists',
      headers: { origin: app.config.corsOrigins[0], cookie: strangerCookie },
      payload: { title: 'Theirs', kind: 'podcast' },
    });
    const theirId = theirs.json().data.playlist.id as string;

    // 404, not 403: a distinct "exists but is not yours" turns the id space
    // into an oracle anyone can enumerate.
    expect((await addShow(theirId, showId)).statusCode).toBe(404);
  });
});

describe('how a playlist looks', () => {
  it('starts on a palette colour with no picture', async () => {
    const playlistId = await createPlaylist();

    const response = await app.inject({
      method: 'GET',
      url: `/me/playlists/${playlistId}`,
      headers: { origin: app.config.corsOrigins[0], cookie },
    });

    expect(response.json().data.playlist).toMatchObject({
      banner: { kind: 'color', color: 'ember', imageUrl: null, text: null },
      backgroundColor: null,
    });
  });

  it('takes a colour, a caption and a page wash', async () => {
    const playlistId = await createPlaylist();

    const response = await app.inject({
      method: 'PATCH',
      url: `/me/playlists/${playlistId}`,
      headers: { origin: app.config.corsOrigins[0], cookie },
      payload: { color: 'ocean', bannerText: '  Vol. 3  ', backgroundColor: 'ocean' },
    });

    expect(response.json().data.playlist).toMatchObject({
      banner: { kind: 'color', color: 'ocean', text: 'Vol. 3' },
      backgroundColor: 'ocean',
    });
  });

  it('refuses a colour it does not have', async () => {
    const playlistId = await createPlaylist();

    const response = await app.inject({
      method: 'PATCH',
      url: `/me/playlists/${playlistId}`,
      headers: { origin: app.config.corsOrigins[0], cookie },
      payload: { color: '#ff0000' },
    });

    // A closed palette is the whole point: a free hex field is how someone
    // ends up with an unreadable title on their own banner.
    expect(response.statusCode).toBe(400);
  });

  it('will not switch to a picture that was never uploaded', async () => {
    const playlistId = await createPlaylist();

    const response = await app.inject({
      method: 'PATCH',
      url: `/me/playlists/${playlistId}`,
      headers: { origin: app.config.corsOrigins[0], cookie },
      payload: { bannerKind: 'image' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a body that is not an image', async () => {
    const playlistId = await createPlaylist();

    const response = await app.inject({
      method: 'POST',
      url: `/me/playlists/${playlistId}/banner`,
      headers: { origin: app.config.corsOrigins[0], cookie, 'content-type': 'image/png' },
      payload: Buffer.from('this is not a PNG, whatever the header says'),
    });

    // Re-encoding is the check. Something that only claims to be a PNG does
    // not survive being decoded and written back out.
    expect(response.statusCode).toBe(400);
  });

  it('stores an uploaded banner and serves it from its versioned URL', async () => {
    const playlistId = await createPlaylist();

    const png = await sharp({
      create: { width: 40, height: 20, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer();

    const upload = await app.inject({
      method: 'POST',
      url: `/me/playlists/${playlistId}/banner`,
      headers: { origin: app.config.corsOrigins[0], cookie, 'content-type': 'image/png' },
      payload: png,
    });

    expect(upload.statusCode).toBe(200);

    const banner = upload.json().data.playlist.banner;
    // Uploading a picture is asking to see it — no second step.
    expect(banner.kind).toBe('image');
    expect(banner.imageUrl).toMatch(/^\/playlists\/[\da-f-]+\/banner\/[\da-f-]+$/);

    const served = await app.inject({ method: 'GET', url: banner.imageUrl });

    expect(served.statusCode).toBe(200);
    // Re-encoded, never stored as sent: that is what strips EXIF and what
    // guarantees the bytes really are an image.
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.rawPayload.length).toBeGreaterThan(0);
  });

  it('does not serve a banner from a stale version', async () => {
    const playlistId = await createPlaylist();

    const png = await sharp({
      create: { width: 40, height: 20, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer();

    const first = await app.inject({
      method: 'POST',
      url: `/me/playlists/${playlistId}/banner`,
      headers: { origin: app.config.corsOrigins[0], cookie, 'content-type': 'image/png' },
      payload: png,
    });
    const firstUrl = first.json().data.playlist.banner.imageUrl as string;

    const second = await app.inject({
      method: 'POST',
      url: `/me/playlists/${playlistId}/banner`,
      headers: { origin: app.config.corsOrigins[0], cookie, 'content-type': 'image/png' },
      payload: png,
    });
    const secondUrl = second.json().data.playlist.banner.imageUrl as string;

    // The version is what makes a replacement visible through every cache
    // between the database and the screen.
    expect(secondUrl).not.toBe(firstUrl);
    expect((await app.inject({ method: 'GET', url: firstUrl })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: secondUrl })).statusCode).toBe(200);
  });

  it('keeps the picture when the banner switches back to a colour', async () => {
    const playlistId = await createPlaylist();

    const png = await sharp({
      create: { width: 40, height: 20, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer();

    await app.inject({
      method: 'POST',
      url: `/me/playlists/${playlistId}/banner`,
      headers: { origin: app.config.corsOrigins[0], cookie, 'content-type': 'image/png' },
      payload: png,
    });

    const back = await app.inject({
      method: 'PATCH',
      url: `/me/playlists/${playlistId}`,
      headers: { origin: app.config.corsOrigins[0], cookie },
      payload: { bannerKind: 'color' },
    });

    // Trying a colour and changing your mind must not cost you the file.
    expect(back.json().data.playlist.banner).toMatchObject({ kind: 'color' });
    expect(back.json().data.playlist.banner.imageUrl).not.toBeNull();

    const dropped = await app.inject({
      method: 'DELETE',
      url: `/me/playlists/${playlistId}/banner`,
      headers: { origin: app.config.corsOrigins[0], cookie },
    });

    expect(dropped.json().data.playlist.banner).toMatchObject({
      kind: 'color',
      imageUrl: null,
    });
  });
});
