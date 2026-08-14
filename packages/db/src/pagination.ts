/**
 * Cursor pagination.
 *
 * Offset pagination is wrong for this product in two ways: `OFFSET 5000` makes
 * Postgres walk 5000 rows it then throws away, and any row inserted while the
 * user is scrolling shifts every subsequent page — so an infinite list either
 * duplicates or skips episodes. A keyset cursor has neither problem and reads
 * straight down an index.
 *
 * The cursor is `(sortValue, id)`. The id is the tiebreaker, which is what
 * makes the ordering total — without it, two episodes published in the same
 * second can straddle a page boundary and one of them is never returned.
 */

const SEPARATOR = '|';

export type Cursor = {
  /** Epoch milliseconds of the sort column. */
  sortValue: number;
  /** Row id, breaking ties on `sortValue`. */
  id: string;
};

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function fromBase64Url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

export function encodeCursor(date: Date, id: string): string {
  return toBase64Url(`${date.getTime()}${SEPARATOR}${id}`);
}

/**
 * Decode a client-supplied cursor.
 *
 * Returns null rather than throwing for anything malformed. Cursors arrive
 * from URLs, which means they arrive truncated, re-encoded and hand-edited —
 * treating that as a 500 would be wrong, and treating it as "start from the
 * beginning" is the behaviour a user actually wants.
 */
export function decodeCursor(cursor: string | null | undefined): Cursor | null {
  if (!cursor) return null;

  let decoded: string;
  try {
    decoded = fromBase64Url(cursor);
  } catch {
    return null;
  }

  const separatorAt = decoded.indexOf(SEPARATOR);
  if (separatorAt <= 0) return null;

  const sortValue = Number(decoded.slice(0, separatorAt));
  const id = decoded.slice(separatorAt + 1);

  if (!Number.isSafeInteger(sortValue) || id.length === 0) return null;

  return { sortValue, id };
}

/**
 * Trim an over-fetched result to the page size and derive the next cursor.
 *
 * Endpoints query `limit + 1` rows. If the extra row came back there is
 * another page — which is how we answer "is there more?" without a second
 * `COUNT(*)` over the same range.
 */
export function paginate<T>(
  rows: T[],
  limit: number,
  toCursor: (row: T) => string,
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) {
    return { items: rows, nextCursor: null };
  }

  const items = rows.slice(0, limit);
  const last = items[items.length - 1];

  return {
    items,
    nextCursor: last === undefined ? null : toCursor(last),
  };
}

/** Page size bounds. Prevents `?limit=100000` becoming a denial of service. */
export const PAGE_SIZE = {
  default: 30,
  max: 100,
} as const;

export function clampLimit(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested)) return PAGE_SIZE.default;
  return Math.min(Math.max(Math.trunc(requested), 1), PAGE_SIZE.max);
}
