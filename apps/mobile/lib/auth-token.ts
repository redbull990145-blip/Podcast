import * as SecureStore from 'expo-secure-store';
import type { AccountSnapshot } from '@cue/core';
import type { SessionUser } from '@cue/types';
import { accountScope } from './account';

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
const IDENTITY_KEY = 'cue.verified-session';
type VerifiedSession = { token: string; user: SessionUser; expiresAt: string };
let verified: VerifiedSession | null | undefined;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let onlineVerifiedToken: string | null = null;

/**
 * Read through a memory cache.
 *
 * The keystore is backed by real crypto hardware and every request would
 * otherwise pay for it. `undefined` means "not looked at yet", which is
 * distinct from `null`, meaning "looked, and there is no token" — collapsing
 * the two would re-hit the keystore on every request of a signed-out session.
 */
let cached: string | null | undefined;
let writes: Promise<void> = Promise.resolve();

function persist(write: () => Promise<void>): Promise<void> {
  const next = writes.catch(() => undefined).then(write);
  writes = next;
  return next;
}

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
  forgetVerifiedSession();
  accountScope.set(null, true);
  cached = token;
  await persist(async () => { await SecureStore.deleteItemAsync(IDENTITY_KEY); await SecureStore.setItemAsync(KEY, token); });
}

export async function clearToken(): Promise<void> {
  forgetVerifiedSession();
  accountScope.set(null, true);
  cached = null;
  await persist(async () => { await SecureStore.deleteItemAsync(KEY); await SecureStore.deleteItemAsync(IDENTITY_KEY); });
}

function forgetVerifiedSession(): void {
  onlineVerifiedToken = null;
  verified = null;
  if (expiryTimer !== null) clearTimeout(expiryTimer);
  expiryTimer = null;
}

export function requireSessionRevalidation(): void { onlineVerifiedToken = null; }
export function hasOnlineSessionVerification(): boolean {
  if (verified && Date.parse(verified.expiresAt) <= Date.now()) {
    void clearToken().catch(() => undefined);
    return false;
  }
  return onlineVerifiedToken !== null && onlineVerifiedToken === getToken() && accountScope.snapshot().accountId !== null;
}

function scheduleExpiry(record: VerifiedSession): void {
  if (expiryTimer !== null) clearTimeout(expiryTimer);
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    if (getToken() !== record.token || verified !== record) return;
    if (Date.parse(record.expiresAt) <= Date.now()) void clearToken().catch(() => undefined);
    else scheduleExpiry(record);
  }, Math.min(2_147_483_647, Math.max(0, Date.parse(record.expiresAt) - Date.now())));
}

/** Only a server-verified identity, bound to this exact stored credential. */
export function readOfflineSession(): { user: SessionUser; sessionExpiresAt: string } | null {
  const token = getToken();
  if (!token) return null;
  if (verified === undefined) {
    try {
      const saved = SecureStore.getItem(IDENTITY_KEY);
      const parsed: unknown = saved ? JSON.parse(saved) : null;
      const candidate = parsed as Partial<VerifiedSession> | null;
      verified = candidate && typeof candidate.token === 'string' && typeof candidate.expiresAt === 'string'
        && typeof candidate.user?.id === 'string' && candidate.user.id.length > 0
        && typeof candidate.user.email === 'string' && typeof candidate.user.name === 'string'
        && (candidate.user.image === null || typeof candidate.user.image === 'string')
        ? candidate as VerifiedSession : null;
    } catch { verified = null; }
  }
  if (!verified || verified.token !== token || !Number.isFinite(Date.parse(verified.expiresAt))) return null;
  if (Date.parse(verified.expiresAt) <= Date.now()) { void clearToken().catch(() => undefined); return null; }
  accountScope.set(verified.user.id);
  scheduleExpiry(verified);
  return { user: verified.user, sessionExpiresAt: verified.expiresAt };
}

/** Save only a response observed under the same credential and generation. */
export async function rememberVerifiedSession(
  result: { user: SessionUser | null; sessionExpiresAt: string | null },
  token: string | null,
  owner: AccountSnapshot,
): Promise<void> {
  if (!accountScope.matches(owner) || token !== getToken()) throw Object.assign(new Error('The account changed'), { name: 'AbortError' });
  if (!result.user) {
    if (token === null && owner.accountId === null) return;
    const clearing = clearToken(); const clearedOwner = accountScope.snapshot();
    await clearing;
    if (!accountScope.matches(clearedOwner) || getToken() !== null) throw Object.assign(new Error('The account changed'), { name: 'AbortError' });
    return;
  }
  if (!token || !result.sessionExpiresAt || !Number.isFinite(Date.parse(result.sessionExpiresAt)) || Date.parse(result.sessionExpiresAt) <= Date.now()) {
    forgetVerifiedSession();
    accountScope.set(result.user.id);
    onlineVerifiedToken = token;
    const acceptedOwner = accountScope.snapshot();
    await persist(() => SecureStore.deleteItemAsync(IDENTITY_KEY));
    if (!accountScope.matches(acceptedOwner) || getToken() !== token) throw Object.assign(new Error('The account changed'), { name: 'AbortError' });
    return;
  }
  const record = { token, user: result.user, expiresAt: result.sessionExpiresAt };
  verified = record;
  accountScope.set(result.user.id);
  onlineVerifiedToken = token;
  scheduleExpiry(record);
  const acceptedOwner = accountScope.snapshot();
  await persist(async () => {
    if (getToken() === token && verified === record) await SecureStore.setItemAsync(IDENTITY_KEY, JSON.stringify(record));
  });
  if (!accountScope.matches(acceptedOwner) || getToken() !== token || verified !== record) throw Object.assign(new Error('The account changed'), { name: 'AbortError' });
}
