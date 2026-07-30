import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encryption for user-supplied API keys.
 *
 * A user's API key is a bearer credential that can spend their money. Storing
 * it in plaintext would mean a read-only database leak is immediately a
 * financial loss for every user who added one, so it is encrypted at rest with
 * a secret that lives only in the server environment.
 *
 * AES-256-GCM is authenticated: tampering with stored ciphertext produces a
 * decryption failure rather than silently different plaintext.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits, the size GCM is specified for
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error(
      "API_KEY_ENCRYPTION_SECRET is not set. Generate one with: openssl rand -base64 32",
    );
  }

  const key = Buffer.from(secret, "base64");
  if (key.length !== 32) {
    throw new Error(
      "API_KEY_ENCRYPTION_SECRET must decode to exactly 32 bytes. Generate one with: openssl rand -base64 32",
    );
  }
  return key;
}

/**
 * Throws with a specific message when the encryption secret is missing or the
 * wrong size, so callers can report an operator problem as an operator problem
 * rather than blaming the user's key.
 */
export function assertEncryptionConfigured(): void {
  getKey();
}

/** Returns base64 of iv || authTag || ciphertext. */
export function encryptApiKey(plaintext: string): string {
  // A fresh random IV per encryption is mandatory for GCM: reusing one with the
  // same key leaks the XOR of the plaintexts and breaks authentication.
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/** Throws if the ciphertext was tampered with or the secret has changed. */
export function decryptApiKey(encrypted: string): string {
  const raw = Buffer.from(encrypted, "base64");
  if (raw.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Stored key is malformed.");
  }

  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}

/**
 * Last four characters, for showing which key is stored without revealing it.
 * Never return anything longer than this to a client.
 */
export function keyHint(plaintext: string): string {
  return plaintext.length <= 4 ? "••••" : `••••${plaintext.slice(-4)}`;
}
