import * as SecureStore from 'expo-secure-store';

/**
 * The session token.
 *
 * The web carries its session in a cookie the browser attaches automatically.
 * React Native has no such ambient jar worth relying on, so the token is held
 * explicitly: written to the Android keystore on sign-in, read back on every
 * request as a bearer header.
 *
 * It lives in its own module rather than in `session.ts` because `api.ts` needs
 * to read it and `session.ts` needs to call the api — putting the token in
 * either one makes that a cycle.
 */

const KEY = 'cue.session-token';

/**
 * Read through a memory cache.
 *
 * The keystore is backed by real crypto hardware and every request would
 * otherwise pay for it. `undefined` means "not looked at yet", which is
 * distinct from `null`, meaning "looked, and there is no token" — collapsing
 * the two would re-hit the keystore on every request of a signed-out session.
 */
let cached: string | null | undefined;

export function getToken(): string | null {
  if (cached !== undefined) return cached;

  try {
    cached = SecureStore.getItem(KEY);
  } catch {
    // A keystore that cannot be read is a signed-out session, not a crash.
    // Sign-in will simply be asked for again.
    cached = null;
  }

  return cached;
}

export async function setToken(token: string): Promise<void> {
  cached = token;
  await SecureStore.setItemAsync(KEY, token);
}

export async function clearToken(): Promise<void> {
  cached = null;
  await SecureStore.deleteItemAsync(KEY);
}
