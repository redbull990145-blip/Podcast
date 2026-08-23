import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import doQueue from '@opennextjs/cloudflare/overrides/queue/do-queue';

/**
 * How this app's Next.js output is adapted to run on Cloudflare Workers.
 *
 * `incrementalCache` is deliberately not set here yet — see the R2 note in
 * wrangler.jsonc for why — but its cost is no longer zero, and two things this
 * comment used to say were wrong.
 *
 * It said the app relied on nothing a missing cache would break. That was true
 * while the three `revalidate` exports were inert; they have since been removed
 * and replaced by the `catalogue` client in lib/api.ts, which requests
 * `next: { revalidate: 300 }` on every public catalogue read. Those requests
 * are live and are currently being thrown away.
 *
 * It also said the fallback is an in-memory cache. It is not: `defineCloudflareConfig`
 * defaults `incrementalCache` to `"dummy"`, whose `get` and `set` both throw
 * `IgnorableError` and store nothing at all. An in-memory cache would at least
 * serve repeat requests within one isolate; this serves none.
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
