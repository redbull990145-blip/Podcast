import type { Config } from "drizzle-kit";
import { config as loadEnv } from "dotenv";

// drizzle-kit is a standalone CLI, not part of the Next.js process, so it does
// not get .env.local loaded for free the way `next dev`/`next build` do.
loadEnv({ path: ".env.local" });

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // We only manage the public schema; Supabase owns `auth`.
  schemaFilter: ["public"],
  verbose: true,
  strict: true,
} satisfies Config;
