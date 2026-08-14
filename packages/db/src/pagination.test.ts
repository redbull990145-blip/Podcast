import { describe, expect, it } from 'vitest';
import { clampLimit, decodeCursor, encodeCursor, PAGE_SIZE, paginate } from './pagination.ts';

describe('cursor encoding', () => {
  const date = new Date('2026-08-13T09:41:00.000Z');
  const id = '3f2b1a04-9c7e-4d51-8b6a-2e0f9d1c4a77';

  it('round-trips', () => {
    const decoded = decodeCursor(encodeCursor(date, id));
    expect(decoded).toEqual({ sortValue: date.getTime(), id });
  });

  it('is URL-safe so it survives a query string untouched', () => {
    const cursor = encodeCursor(date, id);
    expect(cursor).toBe(encodeURIComponent(cursor));
  });

  it('keeps ids containing the separator intact', () => {
    // Only the first separator delimits; the rest belongs to the id. Splitting
    // naively here would corrupt any id that isn't a plain uuid.
    const awkward = 'a|b|c';
    expect(decodeCursor(encodeCursor(date, awkward))?.id).toBe(awkward);
  });
});

describe('decodeCursor rejects bad input by restarting, not throwing', () => {
  // Cursors come from URLs, so they arrive mangled. A 500 would be wrong.
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['not base64', '!!!!'],
    ['no separator', Buffer.from('12345').toString('base64url')],
    ['empty id', Buffer.from('12345|').toString('base64url')],
    ['non-numeric sort', Buffer.from('abc|xyz').toString('base64url')],
    ['leading separator', Buffer.from('|xyz').toString('base64url')],
  ])('%s', (_label, input) => {
    expect(decodeCursor(input)).toBeNull();
  });
});

describe('paginate', () => {
  const rows = Array.from({ length: 11 }, (_, i) => ({ id: `id-${i}` }));
  const toCursor = (row: { id: string }) => row.id;

  it('reports no next page when the extra row did not come back', () => {
    const result = paginate(rows.slice(0, 10), 10, toCursor);
    expect(result.items).toHaveLength(10);
    expect(result.nextCursor).toBeNull();
  });

  it('trims the probe row and points the cursor at the last kept row', () => {
    // The 11th row exists only to answer "is there more?" — it must not be
    // returned, or every page would show one episode twice.
    const result = paginate(rows, 10, toCursor);
    expect(result.items).toHaveLength(10);
    expect(result.items.at(-1)?.id).toBe('id-9');
    expect(result.nextCursor).toBe('id-9');
  });

  it('handles an empty result', () => {
    expect(paginate([], 10, toCursor)).toEqual({ items: [], nextCursor: null });
  });
});

describe('clampLimit', () => {
  it('defaults when unspecified', () => {
    expect(clampLimit(undefined)).toBe(PAGE_SIZE.default);
  });

  it('caps absurd requests instead of letting them through', () => {
    expect(clampLimit(100_000)).toBe(PAGE_SIZE.max);
  });

  it('floors at 1 so a zero or negative limit cannot return everything', () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
  });

  it('rejects NaN rather than propagating it into a query', () => {
    expect(clampLimit(Number.NaN)).toBe(PAGE_SIZE.default);
  });
});
