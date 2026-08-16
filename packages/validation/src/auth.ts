/**
 * Credentials, as both clients check them and the server enforces them.
 *
 * The bounds here are not invented: they mirror `minPasswordLength` and
 * `maxPasswordLength` configured on the auth provider in
 * `apps/api/src/auth/auth.ts`. A client rule that is merely *similar* to the
 * server's is worse than none, because the case where they disagree is
 * invisible until a real person is stuck on a form that says nothing is wrong.
 */

import { z } from 'zod';

/** Mirrors the auth provider's `minPasswordLength`. */
export const PASSWORD_MIN = 8;
/** Mirrors the auth provider's `maxPasswordLength`. */
export const PASSWORD_MAX = 256;

export const email = z
  .email('Enter a valid email address')
  // Long enough for any real address; short enough that a paste of something
  // that is not an address fails on length rather than on a regex timeout.
  .max(320, 'That email address is too long');

export const password = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  // Checked on the client too, so a long passphrase from a password manager
  // fails here — next to the field — rather than after a round trip.
  .max(PASSWORD_MAX, `Passwords can be at most ${PASSWORD_MAX} characters`);

export const displayName = z
  .string()
  .trim()
  .min(1, 'Tell us what to call you')
  .max(80, 'That name is too long');

export const signInInput = z.object({ email, password });
export type SignInInput = z.infer<typeof signInInput>;

export const signUpInput = z.object({ email, password, name: displayName });
export type SignUpInput = z.infer<typeof signUpInput>;

/** Mirrors `otpLength` on the emailOTP plugin in `apps/api/src/auth/auth.ts`. */
export const OTP_LENGTH = 6;

/**
 * A verification code.
 *
 * Digits only and exactly six, so a paste that picked up a stray space or the
 * surrounding word fails here — next to the field — rather than being spent as
 * one of the three attempts the server allows per code.
 */
export const otp = z
  .string()
  .trim()
  .regex(new RegExp(`^\\d{${OTP_LENGTH}}$`), `Enter the ${OTP_LENGTH}-digit code`);

export const verifyEmailInput = z.object({ email, otp });
export type VerifyEmailInput = z.infer<typeof verifyEmailInput>;
