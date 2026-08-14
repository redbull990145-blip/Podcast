/**
 * Encrypting users' own API keys at rest.
 *
 * A provider key is a bearer credential that bills someone real money, so it is
 * never stored in a form the database alone can reveal. AES-256-GCM rather than
 * CBC or a raw stream: GCM authenticates as well as encrypts, so a row that has
 * been tampered with fails to decrypt instead of decrypting into a *different*
 * key that gets sent to a provider.
 *
 * There is deliberately no function here that returns a stored key to a client.
 * Decryption exists to make one outbound call and nothing else.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

/** GCM's standard nonce length. Not 16 — a 16-byte IV weakens GCM's guarantees. */
const IV_BYTES = 12;

/**
 * Derive the 32-byte cipher key from the configured secret.
 *
 * A plain hash rather than scrypt or PBKDF2 because the input is already a
 * high-entropy random value from `openssl rand`, not a human-chosen password.
 * Key stretching defends against brute force over a small search space; there
 * is no small search space here, and the cost would be paid on every call.
 */
function cipherKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

/**
 * Encrypt a key for storage.
 *
 * Returns `iv.tag.ciphertext` in base64url — one opaque string, because the
 * three parts are meaningless apart and a schema that lets them be updated
 * independently invites exactly the bug that silently breaks decryption.
 */
export function encryptSecret(plaintext: string, secret: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, cipherKey(secret), iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

/**
 * Decrypt a stored key.
 *
 * Returns null rather than throwing on anything malformed, tampered with, or
 * encrypted under a different secret. The caller's fallback — "treat this user
 * as having no key" — is correct for every one of those cases, and an
 * exception here would take down a request over a row we can simply ignore.
 */
export function decryptSecret(stored: string, secret: string): string | null {
  const parts = stored.split('.');
  if (parts.length !== 3) return null;

  const [ivPart, tagPart, dataPart] = parts as [string, string, string];

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      cipherKey(secret),
      Buffer.from(ivPart, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    // Wrong secret, truncated row, or a deliberate edit. All mean the same
    // thing to every caller: there is no usable key here.
    return null;
  }
}

/**
 * The last four characters, for the UI to identify which key is saved.
 *
 * Four is not enough to narrow a key meaningfully, and it is what every
 * provider's own dashboard shows — so it reads as familiar rather than as a
 * leak. Short keys are masked entirely rather than mostly revealed.
 */
export function keyHint(plaintext: string): string {
  return plaintext.length < 8 ? '••••' : plaintext.slice(-4);
}
