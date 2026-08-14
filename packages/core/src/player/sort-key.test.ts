import { describe, expect, it } from 'vitest';
import { generateKey, generateKeys } from './sort-key.ts';

describe('generateKey', () => {
  it('produces a key for an empty queue', () => {
    expect(generateKey(null, null)).toBeTruthy();
  });

  it('appends above the last key', () => {
    const first = generateKey(null, null);
    const second = generateKey(first, null);
    expect(second > first).toBe(true);
  });

  it('prepends below the first key', () => {
    const first = generateKey(null, null);
    const before = generateKey(null, first);
    expect(before < first).toBe(true);
  });

  it('inserts strictly between two neighbours', () => {
    const a = generateKey(null, null);
    const b = generateKey(a, null);
    const middle = generateKey(a, b);

    expect(middle > a).toBe(true);
    expect(middle < b).toBe(true);
  });

  it('rejects bounds that are out of order rather than producing a broken key', () => {
    const a = generateKey(null, null);
    const b = generateKey(a, null);
    expect(() => generateKey(b, a)).toThrow(/out of order/);
    expect(() => generateKey(a, a)).toThrow();
  });

  /**
   * The property that matters: you can keep dropping items into the same gap
   * forever. A drag-to-reorder that fails on the fiftieth insert into one spot
   * is a bug nobody finds until a user with a long queue finds it.
   */
  it('supports unbounded repeated insertion into the same gap', () => {
    let low = generateKey(null, null);
    const high = generateKey(low, null);

    for (let i = 0; i < 200; i += 1) {
      const next = generateKey(low, high);
      expect(next > low, `iteration ${i}: ${next} > ${low}`).toBe(true);
      expect(next < high, `iteration ${i}: ${next} < ${high}`).toBe(true);
      low = next;
    }
  });

  it('keeps appended keys short as a queue grows', () => {
    // Appending is the common case. Keys grow by one character per full
    // alphabet consumed, not per append — 200 appends must stay far away from
    // anything that would bloat a row.
    let key = generateKey(null, null);
    for (let i = 0; i < 200; i += 1) key = generateKey(key, null);

    expect(key.length).toBeLessThanOrEqual(8);
  });

  it('tolerates a corrupt key instead of breaking the whole queue', () => {
    expect(() => generateKey('!!!', null)).not.toThrow();
  });
});

describe('generateKeys', () => {
  it('returns strictly ascending keys', () => {
    const keys = generateKeys(50);

    expect(keys).toHaveLength(50);
    for (let i = 1; i < keys.length; i += 1) {
      expect(keys[i]! > keys[i - 1]!).toBe(true);
    }
  });

  it('continues above an existing key', () => {
    const existing = generateKey(null, null);
    const keys = generateKeys(5, existing);
    expect(keys[0]! > existing).toBe(true);
  });

  it('sorts the same way the database will', () => {
    // Keys are compared as plain strings, so the array order and a lexical
    // sort must agree — otherwise ordering breaks the moment it round-trips
    // through Postgres.
    const keys = generateKeys(100);
    expect([...keys].sort()).toEqual(keys);
  });

  it('returns nothing for a count of zero', () => {
    expect(generateKeys(0)).toEqual([]);
  });
});
