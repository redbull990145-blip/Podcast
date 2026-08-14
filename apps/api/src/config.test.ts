import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.ts';

const minimal = { DATABASE_URL: 'postgresql://user:pw@localhost:5432/db' };

describe('loadConfig', () => {
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
