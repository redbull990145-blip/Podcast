import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptApiKey, encryptApiKey, keyHint } from "./api-keys";

beforeAll(() => {
  process.env.API_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
});

describe("api key encryption", () => {
  it("round-trips a key", () => {
    const key = "sk-test-abcdef1234567890";
    expect(decryptApiKey(encryptApiKey(key))).toBe(key);
  });

  it("produces different ciphertext each time for the same input", () => {
    // A fixed IV would make identical keys produce identical ciphertext,
    // revealing which users share a key and breaking GCM's security proof.
    const key = "sk-test-abcdef1234567890";
    expect(encryptApiKey(key)).not.toBe(encryptApiKey(key));
  });

  it("never stores the key in recoverable form", () => {
    const key = "sk-supersecret";
    expect(encryptApiKey(key)).not.toContain(key);
  });

  it("rejects tampered ciphertext rather than returning wrong plaintext", () => {
    const encrypted = encryptApiKey("sk-test-abcdef1234567890");
    const raw = Buffer.from(encrypted, "base64");
    raw[raw.length - 1] ^= 0xff; // flip a bit in the ciphertext

    expect(() => decryptApiKey(raw.toString("base64"))).toThrow();
  });

  it("rejects a truncated payload", () => {
    expect(() => decryptApiKey(Buffer.from("short").toString("base64"))).toThrow(
      /malformed/i,
    );
  });

  it("fails when the secret is the wrong length", () => {
    const original = process.env.API_KEY_ENCRYPTION_SECRET;
    process.env.API_KEY_ENCRYPTION_SECRET = Buffer.from("too short").toString(
      "base64",
    );
    expect(() => encryptApiKey("x")).toThrow(/32 bytes/);
    process.env.API_KEY_ENCRYPTION_SECRET = original;
  });

  it("handles unicode and long keys", () => {
    const key = `sk-${"あ".repeat(50)}-${"x".repeat(200)}`;
    expect(decryptApiKey(encryptApiKey(key))).toBe(key);
  });
});

describe("keyHint", () => {
  it("reveals only the last four characters", () => {
    expect(keyHint("sk-abcdef123456")).toBe("••••3456");
  });

  it("reveals nothing for a very short key", () => {
    expect(keyHint("ab")).toBe("••••");
  });
});
