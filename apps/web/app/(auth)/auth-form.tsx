'use client';

import { ApiClientError } from '@cue/api-client';
import { formatFieldErrors, signInInput, signUpInput } from '@cue/validation';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@cue/api-client';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { api } from '@/lib/api';

type Mode = 'signin' | 'signup';

const COPY = {
  signin: {
    heading: 'Welcome back',
    action: 'Sign in',
    working: 'Signing in…',
    switchText: 'New here?',
    switchAction: 'Create an account',
    switchHref: '/signup',
  },
  signup: {
    heading: 'Make an account',
    action: 'Create account',
    working: 'Creating…',
    switchText: 'Already have one?',
    switchAction: 'Sign in',
    switchHref: '/signin',
  },
} as const;

/**
 * Sign in and sign up, sharing one form.
 *
 * The two differ by one field and some words, so they share an implementation
 * — separate copies of an auth form drift, and the one that drifts is always
 * the one you test less.
 *
 * Validation is deliberately on submit, not per keystroke. Telling someone
 * their email is invalid while they are still on the third character is
 * scolding them for not having finished typing.
 */
export function AuthForm({ mode }: { mode: Mode }) {
  const copy = COPY[mode];
  const router = useRouter();
  const queryClient = useQueryClient();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;

    // The same schema the server enforces, so the form rejects exactly what
    // the API would. Hand-written rules drift: this form used to check a
    // minimum password length and not the maximum, so a passphrase from a
    // password manager passed here and failed there.
    //
    // The two modes are parsed separately rather than through one union, so
    // each branch keeps the concrete input type its request needs.
    const parsed =
      mode === 'signup'
        ? signUpInput.safeParse({ email, password, name })
        : signInInput.safeParse({ email, password });

    if (!parsed.success) {
      const problems = formatFieldErrors(parsed.error);
      setFieldErrors(problems);
      setError(null);
      focusFirstInvalid(problems);
      return;
    }

    setFieldErrors({});
    setBusy(true);
    setError(null);

    try {
      if (mode === 'signup') {
        await api.signUp(signUpInput.parse({ email, password, name }));
      } else {
        await api.signIn(signInInput.parse({ email, password }));
      }

      // The session cookie is set; anything cached for the previous (anonymous)
      // visitor is now wrong.
      await queryClient.invalidateQueries({ queryKey: queryKeys.session });
      router.push('/library');
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiClientError) {
        // The envelope carries field-level detail for exactly this. Without
        // reading it, a rejection lands as a general message at the foot of
        // the form and the field it is about stays unmarked.
        const fields = caught.fields ?? {};
        setFieldErrors(fields);
        setError(Object.keys(fields).length > 0 ? null : caught.message);
        focusFirstInvalid(fields);
      } else {
        setError('Something went wrong. Try again.');
      }
      setBusy(false);
    }
  }

  /**
   * Move to the first field that has a problem.
   *
   * Without it, submitting a long form leaves focus on the button and the
   * error somewhere above — which a screen reader user has to go hunting for,
   * and a sighted user on a phone may not have scrolled to at all.
   */
  function focusFirstInvalid(problems: Record<string, string>): void {
    const order = mode === 'signup' ? ['name', 'email', 'password'] : ['email', 'password'];
    const first = order.find((field) => problems[field]);
    if (!first) return;

    formRef.current
      ?.querySelector<HTMLInputElement>(`[name="${first}"]`)
      ?.focus();
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate className="w-full">
      <h1 className="type-display m-0 text-[var(--color-text-primary)]">{copy.heading}</h1>
      <p className="type-callout mt-2 mb-8 text-[var(--color-text-secondary)]">
        Your library and your place in every episode, on every device.
      </p>

      <div className="flex flex-col gap-4">
        {mode === 'signup' ? (
          <Field
            label="Name"
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            error={fieldErrors['name']}
          />
        ) : null}

        <Field
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          error={fieldErrors['email']}
        />

        <Field
          label="Password"
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          // Tells a password manager to offer a new password on signup and the
          // saved one on signin — the single highest-value attribute on this form.
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          error={fieldErrors['password']}
          {...(mode === 'signup' ? { hint: 'At least 8 characters.' } : {})}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="type-callout mt-4 mb-0 text-[var(--color-danger)]"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-7">
        <Button type="submit" busy={busy}>
          {busy ? copy.working : copy.action}
        </Button>
      </div>

      <p className="type-callout mt-6 mb-0 text-[var(--color-text-secondary)]">
        {copy.switchText}{' '}
        <Link
          href={copy.switchHref as never}
          className="text-[var(--color-accent-text)] underline decoration-[var(--color-border-strong)] underline-offset-4 hover:decoration-[var(--color-accent-text)]"
        >
          {copy.switchAction}
        </Link>
      </p>
    </form>
  );
}
