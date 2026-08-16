'use client';

import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';

type FieldProps = {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  /**
   * Forwarded to the input, so a caller can focus or select it — which the
   * verification screen needs in order to put the caret on the code box and to
   * re-select a rejected code. Declared explicitly because `ref` is not part of
   * `InputHTMLAttributes`; React 19 then passes it through the spread below
   * like any other prop, with no `forwardRef` wrapper.
   */
  ref?: Ref<HTMLInputElement>;
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'>;

/**
 * A labelled text input.
 *
 * The label is a real `<label>` bound by id — not a placeholder standing in for
 * one. Placeholder-as-label disappears the moment someone types, which is
 * exactly when they most need to check what the field wanted, and screen
 * readers announce it inconsistently.
 *
 * Errors are wired with `aria-describedby` and `aria-invalid` so the message is
 * announced with the field rather than sitting nearby as decoration.
 */
export function Field({ label, error, hint, ...input }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  // The error replaces the hint rather than joining it. They say the same
  // thing in the same words — "At least 8 characters." above "Use at least 8
  // characters" reads as two problems, and a screen reader announces the
  // requirement twice.
  const showHint = hint !== undefined && !error;

  const describedBy = [error ? errorId : null, showHint ? hintId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div>
      <label htmlFor={id} className="type-caption mb-2 block text-[var(--color-text-secondary)]">
        {label}
      </label>

      <input
        {...input}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={[
          'w-full rounded-[var(--radius-md)] px-3.5 py-3',
          'bg-[var(--color-surface-raised)] text-[var(--color-text-primary)]',
          'border outline-none',
          'placeholder:text-[var(--color-text-tertiary)]',
          // Border colour is the only thing that moves on focus — no shadow
          // bloom, no scale. The caret and the ring already say "you are here".
          'transition-[border-color] ease-standard',
          error
            ? 'border-[var(--color-danger)]'
            : 'border-[var(--color-border)] focus-visible:border-[var(--color-accent)]',
        ].join(' ')}
      />

      {showHint ? (
        <p id={hintId} className="type-caption mt-2 mb-0 text-[var(--color-text-tertiary)]">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="type-caption mt-2 mb-0 text-[var(--color-danger)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
