'use client';

import { ApiClientError, queryKeys } from '@cue/api-client';
import { formatFieldErrors, verifyEmailInput, OTP_LENGTH } from '@cue/validation';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslator } from '@/components/i18n/locale-provider';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { api } from '@/lib/api';
import { beginAccountTransition } from '@/lib/account';

/**
 * How long before another code can be requested.
 *
 * Not security — the server throttles this properly and is the only opinion
 * that counts. This is so the button cannot be mashed while the first message
 * is still in flight, which produces a second code that invalidates the one
 * already on its way and leaves someone typing a code that has just stopped
 * working.
 */
const RESEND_COOLDOWN_SEC = 30;

/**
 * Entering the code from the verification email.
 *
 * Its own component rather than a third mode of `AuthForm`: it shares no fields
 * with that form, and the thing it must get right — one input, autofocused,
 * that a phone will fill from the notification — is not the thing sign-in has
 * to get right.
 */
export function VerifyForm({ email, onDone }: { email: string; onDone: () => void }) {
  const t = useTranslator();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SEC);
  const inputRef = useRef<HTMLInputElement>(null);

  // The code is the only thing to do on this screen, so the caret starts there
  // rather than making everyone reach for it.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((left) => left - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    const parsed = verifyEmailInput.safeParse({ email, otp: code });
    if (!parsed.success) {
      setFieldErrors(formatFieldErrors(parsed.error));
      setError(null);
      setNotice(null);
      inputRef.current?.focus();
      return;
    }

    setFieldErrors({});
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      beginAccountTransition(queryClient);
      await api.verifyEmail(parsed.data);

      // Verifying signs the account in, so the cached anonymous session is now
      // wrong in exactly the way it is after any other sign-in.
      beginAccountTransition(queryClient);
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
      onDone();
      router.push('/library');
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        setError(caught.message);
      } else {
        setError(t.t('auth.failed'));
      }
      setBusy(false);
      // Select rather than clear: a mistyped digit is far more common than a
      // wholly wrong code, and selecting lets the next keystroke replace it
      // while still leaving it readable.
      inputRef.current?.select();
    }
  }

  async function onResend() {
    if (busy || cooldown > 0) return;

    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await api.sendVerificationOtp({ email });
      setNotice(t.t('auth.resent'));
      setCooldown(RESEND_COOLDOWN_SEC);
      setCode('');
      inputRef.current?.focus();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : t.t('auth.resendFailed'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="w-full">
      <h1 className="type-display m-0 text-[var(--color-text-primary)]">
        {t.t('auth.verifyTitle')}
      </h1>
      {/* The address is inside the sentence rather than appended to it, because
          where it falls is not the same in every language — and it stays a
          `<strong>` so it can still be picked out of the line at a glance. */}
      <p className="type-callout mt-2 mb-8 text-[var(--color-text-secondary)]">
        {t.t('auth.verifyBody', { count: OTP_LENGTH, email })}
      </p>

      <Field
        ref={inputRef}
        label={t.t('auth.verifyCode')}
        name="otp"
        // `inputMode` brings up the number pad on a phone; `one-time-code` is
        // what lets iOS and Android offer the code straight from the
        // notification, which is most of the difference between this screen
        // being two taps and being a trip to another app.
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={OTP_LENGTH}
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
        error={fieldErrors['otp']}
      />

      {error ? (
        <p role="alert" className="type-callout mt-4 mb-0 text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p role="status" className="type-callout mt-4 mb-0 text-[var(--color-text-secondary)]">
          {notice}
        </p>
      ) : null}

      <div className="mt-7">
        <Button type="submit" busy={busy}>
          {busy ? t.t('auth.verifying') : t.t('auth.verify')}
        </Button>
      </div>

      <p className="type-callout mt-6 mb-0 text-[var(--color-text-secondary)]">
        {t.t('auth.noCode')}{' '}
        <button
          type="button"
          onClick={onResend}
          disabled={busy || cooldown > 0}
          className="text-[var(--color-accent-text)] underline decoration-[var(--color-border-strong)] underline-offset-4 hover:decoration-[var(--color-accent-text)] disabled:cursor-not-allowed disabled:opacity-60 disabled:no-underline"
        >
          {cooldown > 0
            ? t.t('auth.resendIn', { seconds: cooldown })
            : t.t('auth.resend')}
        </button>
      </p>
    </form>
  );
}
