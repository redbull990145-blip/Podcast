/**
 * The API envelope.
 *
 * Every endpoint answers in one of two shapes, so clients have exactly one
 * error path to handle rather than guessing per route.
 */

/** Opaque, base64-encoded `(sortValue, id)`. Clients pass it back untouched. */
export type Cursor = string;

export type Page<T> = {
  items: T[];
  /**
   * Cursor for the next page, or null at the end. Presence of a cursor — not
   * a count — is what tells an infinite list whether to keep going, because
   * counting rows on every page is a query the database shouldn't be asked to
   * do.
   */
  nextCursor: Cursor | null;
};

/**
 * Machine-readable failure codes. Clients switch on `code`; `message` is for
 * humans and may change without notice.
 */
export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'upstream_unavailable'
  | 'internal';

export type ApiError = {
  code: ApiErrorCode;
  message: string;
  /** Field-level detail for validation failures: `{ feedUrl: 'must be http(s)' }`. */
  fields?: Record<string, string>;
  /** Present on `rate_limited`; seconds until the caller may retry. */
  retryAfterSec?: number;
};

export type ApiFailure = { ok: false; error: ApiError };
export type ApiSuccess<T> = { ok: true; data: T };
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

/** HTTP status for each code, so the mapping lives in one place. */
export const apiErrorStatus: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  upstream_unavailable: 502,
  internal: 500,
};
