/**
 * Seed the local database with real podcasts.
 *
 * Real feeds rather than fabricated rows, because a UI built against invented
 * data is a UI that has never met a 200-character episode title, a missing
 * duration, artwork with the wrong aspect ratio, or a show with 3,000
 * episodes. Every one of those is normal, and each one breaks a layout that
 * was only ever tested against tidy fixtures.
 *
 *   npm run seed --workspace @cue/api
 */

import { createDatabase, runMigrations } from '@cue/db';
import { loadConfig } from './config.ts';
import { ingestFeed } from './feed/ingest.ts';

/**
 * A deliberately awkward spread: long-running and brand-new, daily and weekly,
 * different languages, and one show large enough to prove pagination.
 */
const FEEDS = [
  // Long-running, weekly, ETag-enabled.
  'https://changelog.com/podcast/feed',
  // ~1000 episodes, sends no ETag — exercises the full re-read path.
  'https://feed.syntax.fm/rss',
  // ~3000 episodes in an 18MB feed — the pagination and chunking stress case.
  'https://feeds.simplecast.com/54nAGcIl',
  // Small back catalogue, so the UI is tested against a short list too.
  'https://shoptalkshow.com/feed/podcast/',
  // A different publisher stack (NPR), mid-sized catalogue.
  'https://feeds.npr.org/510289/podcast.xml',
];
// Non-English seed data is deliberately absent: hardcoding a foreign feed URL
// that rots is worse than none, and PodcastIndex's language filter will supply
// real ones once its credentials are set. The parser already reads `language`
// correctly — `en`, `en-us` and `en-gb` all round-trip in the tests.

async function main(): Promise<void> {
  const config = loadConfig();
  const db = await createDatabase({ connectionString: config.databaseUrl });

  /**
   * Migrate only the in-process dev database, exactly as the server does.
   *
   * `runMigrations` and `drizzle-kit migrate` apply the same SQL files but keep
   * separate ledgers of what has run. Against a real Postgres that already went
   * through `db:migrate`, this saw an empty ledger, tried to create every table
   * again, and failed on `CREATE TABLE "categories"` — a schema error thrown by
   * a script whose job is to load data.
   *
   * Pglite keeps the call because seeding is often the first thing to touch a
   * fresh dev database. A real Postgres gets its schema from the reviewed
   * migration step and nowhere else.
   */
  if (config.databaseUrl.startsWith('pglite:')) {
    const ran = await runMigrations(db);
    if (ran.length > 0) console.warn(`applied ${ran.length} migration(s)`);
  }

  let total = 0;

  for (const feedUrl of FEEDS) {
    process.stdout.write(`${feedUrl} … `);
    const startedAt = Date.now();

    try {
      const result = await ingestFeed(db, feedUrl);
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

      if (result.status === 'ingested') {
        total += result.episodesWritten;
        console.warn(`${result.episodesWritten} episodes (${seconds}s)`);
      } else if (result.status === 'unchanged') {
        console.warn(`unchanged (${seconds}s)`);
      } else {
        console.warn(`${result.status}: ${result.detail}`);
      }
    } catch (error) {
      // One unreachable publisher should not abandon the whole seed.
      console.warn(`failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.warn(`\nSeeded ${total} episodes.`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
