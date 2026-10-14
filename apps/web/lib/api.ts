import { createClient } from '@cue/api-client';
import { accountScope } from './account';
import { purgeCachedData } from './connectivity';

/**
 * The API base URL.
 *
 * Read from the environment at build time on the client, and allowed to differ
 * on the server: server components run inside the same network as the API in
 * production, so they can talk to it directly rather than going back out
 * through the public URL.
 */
const baseUrl =
  process.env['NEXT_PUBLIC_API_URL']?.replace(/\/$/, '') ?? 'http://localhost:8080';

export const api = createClient({ baseUrl, getSessionGeneration: accountScope.generation, getAccountId: () => accountScope.snapshot().accountId, onUnauthorized: () => { accountScope.set(null, true); purgeCachedData(); } });

export { ApiClientError } from '@cue/api-client';
