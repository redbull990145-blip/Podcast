import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import doQueue from '@opennextjs/cloudflare/overrides/queue/do-queue';

/**
 * How this app's Next.js output is adapted to run on Cloudflare Workers.
 *
 * `incrementalCache` is deliberately not set here yet — see the R2 note in
 * wrangler.jsonc for why, and its cost is zero right now regardless: the
 * `revalidate` exports on the three ISR pages are already inert (open task on
 * the `no-store` default in apps/web/lib/api.ts), so there is nothing this
 * app currently relies on that an unconfigured cache would break. Without an
 * override the adapter falls back to an in-memory cache, which is fine for a
 * cache nothing is populating.
 *
 * `queue` stays wired up regardless — it costs nothing to declare and there is
 * no reason to unwind it later. See wrangler.jsonc for the binding it maps to.
 *
 * The name here is matched to its binding by convention, not by reference, so
 * a binding renamed in wrangler.jsonc without a change here fails at runtime.
 */
export default defineCloudflareConfig({
  // What would re-render pages once `revalidate` lapses, once it does.
  queue: doQueue,
});
