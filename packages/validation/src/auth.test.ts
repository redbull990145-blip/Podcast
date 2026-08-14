import { describe, expect, it } from 'vitest';
import { PASSWORD_MAX, PASSWORD_MIN, signInInput, signUpInput } from './auth.ts';
import { formatFieldErrors } from './errors.ts';

/**
 * These bounds are the server's, restated. If the auth provider's configured
 * limits ever change, these are the tests that should fail — the failure mode
 * being guarded against is a client that quietly disagrees with the server
 * about what is acceptable.
 */
describe('credentials', () => {
  const valid = { email: 'listener@example.com', password: 'correct-horse-battery' };

  it('accepts a real address and a long-enough password', () => {
    expect(signInInput.safeParse(valid).success).toBe(true);
  });

  it('rejects something that is not an email', () => {
    const result = signInInput.safeParse({ ...valid, email: 'listener.example.com' });

    expect(result.success).toBe(false);
    expect(formatFieldErrors(result.error!)['email']).toMatch(/valid email/i);
  });

  it(`rejects a password under ${PASSWORD_MIN} characters`, () => {
    const result = signInInput.safeParse({ ...valid, password: 'abc' });

    expect(result.success).toBe(false);
    expect(formatFieldErrors(result.error!)['password']).toMatch(/at least 8/i);
  });

  it(`rejects a password over ${PASSWORD_MAX} characters`, () => {
    // The case the hand-written client rule missed: a passphrase from a
    // password manager passed the form and was rejected by the server, with
    // nothing to attach the message to.
    const result = signInInput.safeParse({ ...valid, password: 'a'.repeat(PASSWORD_MAX + 1) });

    expect(result.success).toBe(false);
    expect(formatFieldErrors(result.error!)['password']).toMatch(/at most/i);
  });

  it('accepts a password exactly at each bound', () => {
    expect(signInInput.safeParse({ ...valid, password: 'a'.repeat(PASSWORD_MIN) }).success).toBe(
      true,
    );
    expect(signInInput.safeParse({ ...valid, password: 'a'.repeat(PASSWORD_MAX) }).success).toBe(
      true,
    );
  });

  it('requires a name to sign up', () => {
    const result = signUpInput.safeParse({ ...valid, name: '   ' });

    expect(result.success).toBe(false);
    expect(formatFieldErrors(result.error!)['name']).toMatch(/call you/i);
  });

  it('trims the name rather than rejecting padding', () => {
    const result = signUpInput.safeParse({ ...valid, name: '  Ada  ' });

    expect(result.success).toBe(true);
    expect(result.data?.name).toBe('Ada');
  });

  it('reports one message per field', () => {
    const result = signUpInput.safeParse({ email: 'nope', password: 'x', name: '' });
    const fields = formatFieldErrors(result.error!);

    // A field showing three complaints at once reads as noise.
    expect(Object.keys(fields).sort()).toEqual(['email', 'name', 'password']);
  });
});
