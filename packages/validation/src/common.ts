/**
 * Shared input schemas.
 *
 * One definition per input, used by the API to validate and by both clients to
 * check before sending. A form that rejects the same value the server would is
 * the difference between "the field turns red instantly" and "a round trip
 * then an error toast".
 */

import { z } from 'zod';

/** Page size bounds mirror `PAGE_SIZE` in @cue/db. */
export const paginationQuery = z.object({
  /** Opaque; the client passes back exactly what it was given. */
  cursor: z.string().min(1).max(512).optional(),
  /**
   * Coerced because query strings are always strings. Without coercion,
   * `?limit=30` fails validation for the least useful reason imaginable.
   */
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type PaginationQuery = z.infer<typeof paginationQuery>;

/**
 * A numbered page request, for an archive somebody is navigating by hand.
 *
 * `page` rather than `offset`, because the client is a pager and pages are what
 * it counts in — asking a component that renders "3 of 40" to multiply by the
 * page size before every request is handing it an off-by-one to make.
 *
 * Capped at 10,000 pages, which is not a product limit so much as a refusal to
 * turn a query string into an unbounded `OFFSET`. At the default page size that
 * is a hundred thousand episodes; the largest feed in existence is a long way
 * short of it, and a scraper asking for page 900,000,000 gets a validation
 * error instead of a sequential scan.
 */
export const numberedPageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type NumberedPageQuery = z.infer<typeof numberedPageQuery>;

/**
 * The catalogue listing, optionally narrowed to one category.
 *
 * A slug rather than an id: the id is a database detail that would put a
 * `smallint` in a URL people share, and the slug is already unique by
 * constraint. Bounded in length so a query string cannot be used to push an
 * arbitrary amount of text into a `WHERE` clause.
 */
export const catalogueQuery = paginationQuery.extend({
  category: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/, 'A category slug is lowercase letters, digits and hyphens.')
    .optional(),
});
export type CatalogueQuery = z.infer<typeof catalogueQuery>;

export const uuidParam = z.object({ id: z.uuid() });
export type UuidParam = z.infer<typeof uuidParam>;

/**
 * A feed URL as the user typed it.
 *
 * Deliberately permissive about *shape* and strict about *scheme*. People
 * paste `example.com/feed.xml` without a protocol constantly, so the client
 * prepends `https://` before validating rather than rejecting them for it.
 * Everything beyond scheme — private IP ranges, redirect targets, response
 * size — is enforced at fetch time, because a hostname's address can change
 * between validation and request.
 */
export const feedUrl = z
  .url({ protocol: /^https?$/ })
  .max(2048, 'Feed URL is implausibly long');

export const feedUrlInput = z.object({ feedUrl });
export type FeedUrlInput = z.infer<typeof feedUrlInput>;

/** BCP-47 language tag, loosely: `en`, `pt-BR`, `zh-Hans-CN`. */
export const languageTag = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'Not a valid language tag')
  .max(35);

export const searchQuery = z.object({
  q: z.string().trim().min(2, 'Search for at least two characters').max(200),
  language: languageTag.optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type SearchQuery = z.infer<typeof searchQuery>;
