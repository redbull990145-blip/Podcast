import { createClient, xhrSse } from '@cue/api-client';
import { getToken } from './auth-token';

/**
 * The API base URL on device.
 *
 * This must be the machine's LAN address, never `localhost` — a phone resolves
 * localhost to itself, so the request never leaves the handset. It is the
 * single most common reason a React Native app "can't reach the server" while
 * the same URL works fine in a browser on the development machine.
 */
const baseUrl = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:8080';

/**
 * `xhrSse` because React Native's `fetch` has no `response.body` — it is
 * implemented over XMLHttpRequest and cannot stream a response. Without this
 * the Ask answer would arrive in one silent lump after several seconds, on the
 * platform where that wait is least tolerable.
 */
export const api = createClient({ baseUrl, getAuthToken: getToken, sse: xhrSse });

export { ApiClientError } from '@cue/api-client';
