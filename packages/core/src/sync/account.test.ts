import { describe, expect, it } from 'vitest';
import { AccountScope } from './account.ts';

describe('account generation', () => {
  it('invalidates old work even when the same account signs in again', () => {
    const scope = new AccountScope();
    scope.set('A');
    const first = scope.snapshot();
    scope.set(null, true);
    scope.set('A');
    expect(scope.matches(first)).toBe(false);
    expect(scope.snapshot().accountId).toBe('A');
  });
  it('retains the generation on a refresh of the same verified identity', () => {
    const scope = new AccountScope();
    scope.set('A');
    const first = scope.snapshot();
    scope.set('A');
    expect(scope.matches(first)).toBe(true);
    scope.set('B');
    expect(scope.matches(first)).toBe(false);
  });
});
