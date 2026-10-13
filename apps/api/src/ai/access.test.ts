import { aiUsage, userApiKeys, users, type Database } from '@cue/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config.ts';
import { createTestDatabase, type TestDatabase } from '../test/database.ts';
import { claimQuota, keyFor, resolve } from './access.ts';
import { encryptSecret } from './crypto.ts';

let harness: TestDatabase;
let app: FastifyInstance;
const userId = 'funding-test';
const encryption = 'a-test-encryption-secret-32-chars';
beforeAll(async () => {
  harness = await createTestDatabase();
  await harness.insert(users).values({ id: userId, name: 'Test', email: 'funding@example.test' });
  app = {
    db: harness as unknown as Database,
    config: loadConfig({
      DATABASE_URL: 'pglite://memory',
      API_KEY_ENCRYPTION_SECRET: encryption,
      GROQ_API_KEY: 'operator-test-key',
      AI_DAILY_QUOTA: '0',
    }),
  } as FastifyInstance;
});
beforeEach(async () => {
  await harness.delete(userApiKeys);
  await harness.delete(aiUsage);
});
afterAll(async () => {
  await harness.$close();
});
async function saveOwn() {
  await harness.insert(userApiKeys).values({
    userId,
    provider: 'groq',
    secret: encryptSecret('own-test-key', encryption),
    hint: 'test',
  });
}
describe('admitted funding source', () => {
  it('does not fall back to an unreserved operator key after BYOK is deleted', async () => {
    await saveOwn();
    expect(await claimQuota(app, userId)).toEqual({
      metered: false,
      day: null,
    });
    await harness.delete(userApiKeys).where(eq(userApiKeys.userId, userId));
    await expect(keyFor(app, userId, 'byok')).rejects.toThrow(/requires your own/);
    expect(await harness.select().from(aiUsage)).toEqual([]);
  });
  it('keeps a metered job on operator funding even if a user later saves BYOK', async () => {
    await saveOwn();
    expect(await keyFor(app, userId, 'operator')).toEqual({
      key: 'operator-test-key',
      byok: false,
    });
  });
  it('rejects undecryptable BYOK rather than silently spending operator funds', async () => {
    await harness
      .insert(userApiKeys)
      .values({ userId, provider: 'groq', secret: 'unreadable', hint: 'test' });
    await expect(resolve(app, userId)).rejects.toThrow(/cannot be read/);
    await expect(claimQuota(app, userId)).rejects.toThrow(/cannot be read/);
    expect(await harness.select().from(aiUsage)).toEqual([]);
  });
  it('enforces a zero operator allowance', async () => {
    await expect(claimQuota(app, userId)).rejects.toMatchObject({
      code: 'rate_limited',
    });
    expect(await harness.select().from(aiUsage)).toEqual([]);
  });
  it('fails closed when a saved BYOK key has no configured decryption secret', async () => {
    await saveOwn();
    const unreadable = {
      ...app,
      config: { ...app.config, ai: { ...app.config.ai, encryptionSecret: null } },
    } as FastifyInstance;
    await expect(claimQuota(unreadable, userId)).rejects.toThrow(/cannot be read/);
    await expect(keyFor(unreadable, userId, 'byok')).rejects.toThrow(/cannot be read/);
    await expect(resolve(unreadable, userId)).rejects.toThrow(/cannot be read/);
    expect(await harness.select().from(aiUsage)).toEqual([]);
  });
});
