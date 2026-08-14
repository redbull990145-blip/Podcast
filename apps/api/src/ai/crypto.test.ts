import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, keyHint } from './crypto.ts';

const SECRET = 'v9dKq2mA0pR7wZ4sT1uYx6Nb3EcHjLg8';
const KEY = 'gsk_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH';

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a key', () => {
    expect(decryptSecret(encryptSecret(KEY, SECRET), SECRET)).toBe(KEY);
  });

  it('produces a different ciphertext every time', () => {
    // A fresh IV per encryption. Reusing one under the same key is the classic
    // GCM failure, and it leaks that two users saved the same key.
    expect(encryptSecret(KEY, SECRET)).not.toBe(encryptSecret(KEY, SECRET));
  });

  it('never leaves the plaintext recoverable from the stored form', () => {
    const stored = encryptSecret(KEY, SECRET);
    expect(stored).not.toContain(KEY);
    expect(Buffer.from(stored, 'utf8').toString()).not.toContain('gsk_');
  });

  it('refuses a ciphertext encrypted under a different secret', () => {
    // What a rotated `API_KEY_ENCRYPTION_SECRET` looks like. Null, not a throw:
    // the caller treats it as "no key", which is right.
    const stored = encryptSecret(KEY, SECRET);
    expect(decryptSecret(stored, 'a-completely-different-secret-value')).toBeNull();
  });

  it('refuses a tampered ciphertext rather than returning a different key', () => {
    // The reason for GCM over CBC. A flipped byte must fail, not decrypt into
    // something else that then gets sent to a provider.
    const stored = encryptSecret(KEY, SECRET);
    const [iv, tag, data] = stored.split('.') as [string, string, string];
    const flipped = `${data.slice(0, -2)}${data.slice(-2) === 'AA' ? 'AB' : 'AA'}`;
    expect(decryptSecret(`${iv}.${tag}.${flipped}`, SECRET)).toBeNull();
  });

  it('refuses a tampered auth tag', () => {
    const stored = encryptSecret(KEY, SECRET);
    const [iv, , data] = stored.split('.') as [string, string, string];
    const forged = Buffer.alloc(16, 7).toString('base64url');
    expect(decryptSecret(`${iv}.${forged}.${data}`, SECRET)).toBeNull();
  });

  it.each([['', 'empty'], ['nonsense', 'unstructured'], ['a.b', 'too few parts'], ['a.b.c.d', 'too many parts']])(
    'returns null for a malformed row (%s)',
    (stored) => {
      expect(decryptSecret(stored, SECRET)).toBeNull();
    },
  );

  it('handles a key with characters outside ASCII', () => {
    // Not expected from a provider, but the column is text and a paste can
    // carry anything. Round-tripping must not depend on the byte length
    // matching the character length.
    const odd = 'ключ-🔑-ключ';
    expect(decryptSecret(encryptSecret(odd, SECRET), SECRET)).toBe(odd);
  });
});

describe('keyHint', () => {
  it('shows the last four characters, as provider dashboards do', () => {
    expect(keyHint(KEY)).toBe('EFGH');
  });

  it('masks a key too short to reveal any of', () => {
    expect(keyHint('abc')).toBe('••••');
  });
});
