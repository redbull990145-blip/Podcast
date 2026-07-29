import type { Config } from "drizzle-kit";

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
