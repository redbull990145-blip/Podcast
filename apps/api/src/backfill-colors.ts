/**
 * Re-extract every stored artwork colour.
 *
 * `accent_color` is written once, at ingest, and only when a show's artwork URL
 * *changes* — which is the right rule for normal operation and the wrong one
 * the day the extractor itself changes. Without this, a catalogue keeps
 * whichever colours the old algorithm produced until each publisher happens to
 * move their cover, and the palette is inconsistent across the product for as
 * long as that takes.
 *
 *   npm run backfill:colors --workspace @cue/api
 *   npm run backfill:colors --workspace @cue/api -- --dry-run --limit 20
 *
 * Safe to interrupt and safe to re-run: it holds no state beyond the rows it
 * has already written, and rows are processed in id order.
 */

import { createDatabase, episodes, podcasts, type Database } from '@cue/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { loadConfig } from './config.ts';
import { extractArtworkColor } from './feed/artwork-color.ts';

/**
 * A pause between covers.
 *
 * Two reasons, and the second is the real one: publishers' CDNs should not see
 * a catalogue-sized burst from one client, and the API runs alongside a
 * transcription worker in a container where a decode queue is the difference
 * between slow and OOM-killed. Sequential with a gap is unhurried on purpose —
 * this is a migration, not a request path.
 */
const DELAY_MS = 120;

type Row = { id: string; artworkUrl: string | null; accentColor: string | null };

type Options = { dryRun: boolean; limit: number | null };

function parseArgs(argv: string[]): Options {
  const limitArg = argv.find((arg) => arg.startsWith('--limit'));
  const rawLimit = limitArg?.includes('=')
    ? limitArg.split('=')[1]
    : limitArg
      ? argv[argv.indexOf(limitArg) + 1]
      : undefined;

  const limit = rawLimit ? Number.parseInt(rawLimit, 10) : Number.NaN;

  return {
    dryRun: argv.includes('--dry-run'),
    limit: Number.isFinite(limit) && limit > 0 ? limit : null,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Walk one table's rows, re-extract, and write what changed.
 *
 * A null result is never written. A CDN that is down for the minute this runs
 * would otherwise erase a perfectly good colour and leave the show untinted
 * until its publisher next edits their feed — the same rule the lazy
 * `/episodes/:id/tint` route follows for the same reason.
 */
async function backfill(
  db: Database,
  label: string,
  rows: Row[],
  write: (id: string, color: string) => Promise<unknown>,
  options: Options,
): Promise<void> {
  console.warn(`\n${label}: ${rows.length} row(s)`);

  let updated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const [index, row] of rows.entries()) {
    const color = await extractArtworkColor(row.artworkUrl);
    const position = `[${index + 1}/${rows.length}]`;

    if (!color) {
      failed += 1;
      console.warn(`${position} ${row.id} ${row.accentColor ?? 'null'} → no colour (kept)`);
    } else if (color === row.accentColor) {
      unchanged += 1;
    } else {
      updated += 1;
      console.warn(`${position} ${row.id} ${row.accentColor ?? 'null'} → ${color}`);
      if (!options.dryRun) await write(row.id, color);
    }

    await sleep(DELAY_MS);
  }

  console.warn(
    `${label}: ${updated} updated, ${unchanged} unchanged, ${failed} no colour` +
      (options.dryRun ? ' (dry run — nothing written)' : ''),
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const db = await createDatabase({ connectionString: config.databaseUrl });

  if (options.dryRun) console.warn('Dry run: reporting what would change, writing nothing.\n');

  const showRows = await db
    .select({
      id: podcasts.id,
      artworkUrl: podcasts.artworkUrl,
      accentColor: podcasts.accentColor,
    })
    .from(podcasts)
    .where(isNotNull(podcasts.artworkUrl))
    // Ordered by id so an interrupted run resumes over the same sequence
    // rather than a different arbitrary one.
    .orderBy(podcasts.id)
    .limit(options.limit ?? Number.MAX_SAFE_INTEGER);

  await backfill(
    db,
    'podcasts',
    showRows,
    (id, color) =>
      db
        .update(podcasts)
        .set({ accentColor: color })
        .where(eq(podcasts.id, id)),
    options,
  );

  /*
    Only episodes that already have a colour.

    Episode colours are filled lazily on first play, so a null here means
    nobody has opened it — and that row will get the new extractor for free the
    first time somebody does. Re-extracting all of them would mean fetching an
    image for every episode of every show in the catalogue, which is exactly
    the work the lazy route exists to avoid.
  */
  const episodeRows = await db
    .select({
      id: episodes.id,
      artworkUrl: episodes.artworkUrl,
      accentColor: episodes.accentColor,
    })
    .from(episodes)
    .where(and(isNotNull(episodes.accentColor), isNotNull(episodes.artworkUrl)))
    .orderBy(episodes.id)
    .limit(options.limit ?? Number.MAX_SAFE_INTEGER);

  await backfill(
    db,
    'episodes',
    episodeRows,
    (id, color) =>
      db
        .update(episodes)
        .set({ accentColor: color })
        .where(eq(episodes.id, id)),
    options,
  );

  process.exit(0);
}

main().catch((error: unknown) => {
  console.error('Backfill failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
