import { defineConfig } from 'drizzle-kit';

/**
 * `generate` only diffs the schema against the existing migration files — it
 * never opens a connection. Demanding a database in order to *author* a
 * migration would mean you can't write one offline, and CI couldn't check that
 * the committed SQL still matches the schema.
 */
const isGenerate = process.argv.includes('generate');
const url = process.env['DATABASE_URL'];

if (!url && !isGenerate) {
  throw new Error('DATABASE_URL is required for this command. Copy .env.example to .env.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: url ?? '' },
  // Migrations are reviewed as SQL before they run. `db:push` exists for local
  // iteration only — production changes go through a generated migration file
  // so there is a record of what altered the schema and when.
  strict: true,
  verbose: true,
});
