/**
 * Fractional indexing for queue order.
 *
 * The naive queue stores an integer position per row, so moving one item
 * renumbers every row after it. On a 200-item queue that is 200 writes and a
 * visible stall for a drag that should feel weightless — and if two devices
 * reorder at once, the renumbering collides.
 *
 * Instead each item holds a string key, and inserting between two items means
 * generating a key that sorts between them. One row changes, however long the
 * queue is, and two devices inserting in the same gap produce different keys
 * rather than fighting over one number.
 *
 * Keys are compared as plain strings, so ordering is the database's default
 * collation and needs no special index.
 */

/**
 * Digits, in ascending ASCII order.
 *
 * Deliberately not the full printable range: this alphabet is unambiguous in a
 * URL, a log line, and a hand-typed test, and the extra density buys nothing at
 * queue length.
 */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const BASE = DIGITS.length;
const MID = DIGITS[Math.floor(BASE / 2)]!;

function digitValue(char: string): number {
  const index = DIGITS.indexOf(char);
  // An unknown character sorts as the lowest digit rather than throwing —
  // a corrupt key must not be able to break an entire queue from loading.
  return index === -1 ? 0 : index;
}

/**
 * A key that sorts strictly between `before` and `after`.
 *
 * Either bound may be null, meaning "no neighbour on that side":
 *   - `generateKey(null, null)` — the first item in an empty queue
 *   - `generateKey(last, null)` — appending
 *   - `generateKey(null, first)` — playing something next, before everything
 */
export function generateKey(before: string | null, after: string | null): string {
  if (!before && !after) return MID;

  if (!before) {
    // Prepend: find a key below `after`.
    return keyBefore(after!);
  }

  if (!after) {
    // Append: find a key above `before`.
    return keyAfter(before);
  }

  if (before >= after) {
    throw new Error(`Cannot order between "${before}" and "${after}" — bounds are out of order`);
  }

  return keyBetween(before, after);
}

function keyAfter(before: string): string {
  // Walk from the end looking for a digit that can be incremented. This keeps
  // appended keys the same length as their predecessor wherever possible,
  // instead of growing on every append.
  for (let i = before.length - 1; i >= 0; i -= 1) {
    const value = digitValue(before[i]!);
    if (value < BASE - 1) {
      return before.slice(0, i) + DIGITS[value + 1];
    }
  }

  // Every digit was already the maximum, so extend instead. Extending with the
  // *lowest* digit rather than the middle one leaves the full alphabet of
  // headroom at the new depth — appending with a mid digit throws half of it
  // away and makes keys grow twice as fast.
  //
  // Any appended digit sorts above the bare prefix, since a prefix sorts first.
  return before + DIGITS[0];
}

function keyBefore(after: string): string {
  for (let i = after.length - 1; i >= 0; i -= 1) {
    const value = digitValue(after[i]!);
    if (value > 0) {
      const head = after.slice(0, i) + DIGITS[value - 1];
      // `after` may itself be a prefix-extension; append a mid digit so the
      // result stays strictly below it rather than equal to a truncation.
      return i === after.length - 1 ? head : head + MID;
    }
  }

  // All zeros: go deeper rather than lower.
  return after + DIGITS[0] + MID;
}

function keyBetween(before: string, after: string): string {
  let prefix = '';
  let index = 0;

  // Copy the shared prefix; the decision happens at the first differing digit.
  for (;;) {
    const b = index < before.length ? digitValue(before[index]!) : -1;
    const a = index < after.length ? digitValue(after[index]!) : BASE;

    if (b !== a) {
      if (a - b > 1) {
        // There is room between them at this position.
        return prefix + DIGITS[b + Math.floor((a - b) / 2)];
      }

      // Adjacent digits: keep `before`'s digit and find room in the next
      // position down, which is what makes arbitrarily fine insertion work.
      prefix += index < before.length ? before[index]! : DIGITS[0];
      const rest = before.slice(index + 1);
      return prefix + (rest.length > 0 ? keyAfter(rest) : MID);
    }

    prefix += DIGITS[b];
    index += 1;
  }
}

/**
 * Keys for `count` items appended in order — used when seeding a queue, so a
 * bulk insert does not have to call `generateKey` in a loop against its own
 * previous result.
 */
export function generateKeys(count: number, after: string | null = null): string[] {
  const keys: string[] = [];
  let previous = after;

  for (let i = 0; i < count; i += 1) {
    const key = generateKey(previous, null);
    keys.push(key);
    previous = key;
  }

  return keys;
}
