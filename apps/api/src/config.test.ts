import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';
import { buildServer } from './server.ts';

const minimal = { DATABASE_URL: 'postgresql://user:pw@localhost:5432/db' };

describe('loadConfig', () => {
  it('requires a separate explicit opt-in before opening persistent PGlite', async () => {
    expect(() => loadConfig({ DATABASE_URL: 'pglite://existing-database' })).toThrow(/PGLITE_AUTO_MIGRATE/);
    const config = loadConfig(minimal);
    await expect(buildServer({ ...config, databaseUrl: 'pglite://must-not-be-created' })).rejects.toThrow(/PGLITE_AUTO_MIGRATE/);
  });
  it('retains memory-only tests and permits only an explicit persistent migration opt-in', () => {
    expect(loadConfig({ DATABASE_URL: 'pglite://memory' }).allowPersistentPgliteMigrations).toBe(false);
    expect(loadConfig({ DATABASE_URL: 'pglite://' }).allowPersistentPgliteMigrations).toBe(false);
    expect(loadConfig({ DATABASE_URL: 'pglite://approved-fixture', PGLITE_AUTO_MIGRATE: 'true' }).allowPersistentPgliteMigrations).toBe(true);
    expect(() => loadConfig({ DATABASE_URL: 'pglite://fixture', PGLITE_AUTO_MIGRATE: 'yes' })).toThrow();
  });
  it('rejects the shipped development signing secret in production even when explicitly set', () => {
    const developmentSecret = loadConfig(minimal).authSecret;
    expect(() => loadConfig({ ...minimal, NODE_ENV: 'production', BETTER_AUTH_SECRET: developmentSecret })).toThrow(/BETTER_AUTH_SECRET/);
  });
  it('refuses to start without a database URL', () => {
    // Failing at boot beats 500ing on the first request that needed it.
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('names every problem at once rather than one per restart', () => {
    expect(() => loadConfig({ PORT: 'not-a-number' })).toThrow(/DATABASE_URL[\s\S]*PORT|PORT[\s\S]*DATABASE_URL/);
  });

  it('binds 0.0.0.0 by default so a LAN device can reach the dev server', () => {
    // A physical Android phone cannot reach the host's localhost.
    expect(loadConfig(minimal).host).toBe('0.0.0.0');
  });

  it('treats Redis as absent unless both halves are present', () => {
    expect(loadConfig(minimal).redis).toBeNull();
    expect(loadConfig({ ...minimal, REDIS_URL: 'https://x.upstash.io' }).redis).toBeNull();
    expect(loadConfig({ ...minimal, REDIS_TOKEN: 'tok' }).redis).toBeNull();

    const both = loadConfig({ ...minimal, REDIS_URL: 'https://x.upstash.io', REDIS_TOKEN: 'tok' });
    expect(both.redis).toEqual({ url: 'https://x.upstash.io', token: 'tok' });
  });

  it('splits and trims the CORS origin list', () => {
    const config = loadConfig({
      ...minimal,
      CORS_ORIGINS: 'http://localhost:3000, https://cue.app ,',
    });
    expect(config.corsOrigins).toEqual(['http://localhost:3000', 'https://cue.app']);
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadConfig({ ...minimal, PORT: '99999' })).toThrow();
  });

  /**
   * A hand-written `.env` is full of `KEY=` lines waiting to be filled in, and
   * every one of them arrives here as an empty string rather than as absent.
   * Treating those as *set* is how a blank optional variable stops the API
   * booting, with an error about string length that names neither the file nor
   * the fact that the value is simply blank.
   */
  describe('proxy trust', () => {
    it('ignores forwarding headers by default', () => {
      // The default has to suit the deployment shape, because whoever forgets
      // to set it is the person who most needs it to be right.
      expect(loadConfig(minimal).trustProxy).toBe(false);
    });

    it('turns 0 into false rather than trusting zero hops of a header', () => {
      // `trustProxy: 0` and `trustProxy: false` are not the same thing to
      // Fastify. Zero is how someone spells "nothing is in front of me", and it
      // has to reach Fastify as an instruction to ignore the headers outright.
      expect(loadConfig({ ...minimal, TRUST_PROXY_HOPS: '0' }).trustProxy).toBe(false);
    });

    it('requires explicit proxy addresses instead of hop counts', () => {
      expect(() => loadConfig({ ...minimal, TRUST_PROXY_HOPS: '2' })).toThrow(/TRUST_PROXY_ADDRESSES/);
      expect(loadConfig({ ...minimal, TRUST_PROXY_ADDRESSES: '127.0.0.1, 10.0.0.0/24' }).trustProxy).toEqual(['127.0.0.1', '10.0.0.0/24']);
      for (const address of ['0.0.0.0/0', '::/0', 'true', '10.0.0.1/99', '10.0.0.1/no']) {
        expect(() => loadConfig({ ...minimal, TRUST_PROXY_ADDRESSES: address })).toThrow(/TRUST_PROXY_ADDRESSES/);
      }
    });

    it('refuses a negative hop count', () => {
      expect(() => loadConfig({ ...minimal, TRUST_PROXY_HOPS: '-1' })).toThrow(/TRUST_PROXY_HOPS/);
    });
  });

  describe('blank values', () => {
    it('starts with every optional variable left blank', () => {
      expect(() =>
        loadConfig({
          ...minimal,
          REDIS_URL: '',
          REDIS_TOKEN: '',
          PODCASTINDEX_KEY: '',
          PODCASTINDEX_SECRET: '',
          BETTER_AUTH_SECRET: '',
          BETTER_AUTH_URL: '',
        }),
      ).not.toThrow();
    });

    it('reads a blank optional as absent, not as a value that failed its rule', () => {
      const config = loadConfig({ ...minimal, BETTER_AUTH_SECRET: '', REDIS_URL: '' });
      // Falls back to the development secret, exactly as an unset variable does.
      expect(config.authSecret).toContain('development');
      expect(config.redis).toBeNull();
    });

    it('falls back to the default origin when CORS_ORIGINS is blank', () => {
      // The dangerous one: a blank here used to parse as a valid empty string,
      // skip the default, and split into `[]` — turning "allow localhost" into
      // "allow nothing" and blocking every browser request.
      expect(loadConfig({ ...minimal, CORS_ORIGINS: '' }).corsOrigins).toEqual([
        'http://localhost:3000',
      ]);
    });

    it('still rejects a value that is present and genuinely too short', () => {
      // Blank means unset; wrong still means wrong.
      expect(() => loadConfig({ ...minimal, BETTER_AUTH_SECRET: 'short' })).toThrow();
    });
  });
});
