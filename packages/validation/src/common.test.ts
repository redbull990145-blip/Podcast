import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  catalogueQuery,
  feedUrl,
  languageTag,
  paginationQuery,
  searchQuery,
} from './common.ts';
import { formatFieldErrors } from './errors.ts';

describe('feedUrl', () => {
  it.each([
    'https://example.com/feed.xml',
    'http://example.com/rss',
    'https://example.com/feed?format=rss&id=1',
  ])('accepts %s', (url) => {
    expect(feedUrl.safeParse(url).success).toBe(true);
  });

  it.each([
    ['no scheme', 'example.com/feed.xml'],
    ['file scheme', 'file:///etc/passwd'],
    ['ftp scheme', 'ftp://example.com/feed.xml'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['not a url', 'nonsense'],
  ])('rejects %s', (_label, url) => {
    expect(feedUrl.safeParse(url).success).toBe(false);
  });

  it('rejects an implausibly long URL before it reaches a unique index', () => {
    expect(feedUrl.safeParse(`https://example.com/${'a'.repeat(2100)}`).success).toBe(false);
  });
});

describe('paginationQuery', () => {
  it('coerces a string limit, because query params are always strings', () => {
    const parsed = paginationQuery.parse({ limit: '30' });
    expect(parsed.limit).toBe(30);
  });

  it('rejects a limit above the cap rather than silently clamping it', () => {
    // Silently clamping hides a client bug; rejecting surfaces it.
    expect(paginationQuery.safeParse({ limit: '5000' }).success).toBe(false);
  });

  it('rejects a fractional limit', () => {
    expect(paginationQuery.safeParse({ limit: '2.5' }).success).toBe(false);
  });

  it('allows an empty query — first page, default size', () => {
    expect(paginationQuery.parse({})).toEqual({});
  });
});

describe('languageTag', () => {
  it.each(['en', 'hi', 'pt-BR', 'zh-Hans-CN'])('accepts %s', (tag) => {
    expect(languageTag.safeParse(tag).success).toBe(true);
  });

  it.each(['english', 'e', 'EN-us-'])('rejects %s', (tag) => {
    expect(languageTag.safeParse(tag).success).toBe(false);
  });
});

describe('searchQuery', () => {
  it('trims before checking length, so spaces are not a query', () => {
    expect(searchQuery.safeParse({ q: '   ' }).success).toBe(false);
  });

  it('requires two characters', () => {
    expect(searchQuery.safeParse({ q: 'a' }).success).toBe(false);
    expect(searchQuery.safeParse({ q: 'ab' }).success).toBe(true);
  });
});

describe('formatFieldErrors', () => {
  const schema = z.object({
    feedUrl: z.url(),
    profile: z.object({ locale: z.string().min(2) }),
  });

  it('addresses fields by dotted path so a form can find them', () => {
    const result = schema.safeParse({ feedUrl: 'nope', profile: { locale: 'x' } });
    const fields = formatFieldErrors(result.error!);

    expect(Object.keys(fields)).toEqual(['feedUrl', 'profile.locale']);
    expect(fields['feedUrl']).toBeTruthy();
  });

  it('reports one message per field even when several checks fail', () => {
    // "ab" fails both the length and the digits-only check. A field showing
    // two complaints at once reads as noise.
    const strict = z.object({ code: z.string().min(5).regex(/^\d+$/) });
    const result = strict.safeParse({ code: 'ab' });

    expect(result.error!.issues.length).toBeGreaterThan(1);
    expect(Object.values(formatFieldErrors(result.error!))).toHaveLength(1);
  });
});

/**
 * The catalogue's category filter.
 *
 * A slug reaches a `WHERE` clause, so what it is allowed to be is worth
 * pinning down rather than leaving to the query builder's escaping. The regex
 * is the actual guarantee; these are the cases that would otherwise be
 * discovered by someone editing a URL.
 */
describe('catalogueQuery', () => {
  it('keeps the pagination fields it extends', () => {
    const parsed = catalogueQuery.parse({ limit: '30', category: 'true-crime' });
    expect(parsed.limit).toBe(30);
    expect(parsed.category).toBe('true-crime');
  });

  it('is optional — the unfiltered catalogue is the common case', () => {
    expect(catalogueQuery.parse({}).category).toBeUndefined();
  });

  it.each([
    ['uppercase', 'True-Crime'],
    ['a space', 'true crime'],
    ['an underscore', 'true_crime'],
    ['a quote', "true'crime"],
    ['a wildcard', 'true%'],
    ['empty', ''],
  ])('rejects %s', (_label, slug) => {
    expect(catalogueQuery.safeParse({ category: slug }).success).toBe(false);
  });

  it('rejects a slug long enough to be a payload rather than a name', () => {
    expect(catalogueQuery.safeParse({ category: 'a'.repeat(65) }).success).toBe(false);
  });
});
