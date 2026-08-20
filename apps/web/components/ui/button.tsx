'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonProps = {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  /** Shows a working state and blocks repeat submissions. */
  busy?: boolean;
  /** Overrides the accent with an artwork-derived tint. */
  tint?: string | undefined;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>;

/**
 * The one button.
 *
 * Press feedback is a 60ms scale to 0.97 — small enough that nobody would
 * describe it, absent enough that its removal makes the control feel dead.
 * That is the whole brief for a button: confirm the touch landed, then get out
 * of the way.
 *
 * A busy button keeps its label and its width. Swapping the text for a spinner
 * reflows the row and loses the one piece of information the user needs, which
 * is what they just asked for.
 */
export function Button({
  children,
  variant = 'primary',
  busy = false,
  tint,
  disabled,
  ...props
}: ButtonProps) {
  const base = [
    'relative inline-flex items-center justify-center gap-2',
    // A pill, and that is the design's one hard rule about controls: the
    // things that *do* something are round-ended, the things that hold content
    // are panels. It is what lets a reader tell a button from a card without
    // reading either.
    'rounded-full px-5',
    // 44px minimum target — below this a control is a bug on a touch device.
    'min-h-[44px] type-body-strong',
    'cursor-pointer select-none border',
    'transition-[transform,background-color,border-color,opacity]',
    'duration-[var(--duration-instant)] ease-standard',
    'active:scale-[0.97]',
    'disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100',
    // Motion-sensitive users keep the colour change and lose the squash.
    'motion-reduce:active:scale-100',
  ];

  /**
   * Primary is ink, not accent.
   *
   * The accent marks what is playing, everywhere in this product. A primary
   * action is not that, and painting Sign in, Follow and Save the same orange
   * as the progress bar makes the one signal that carries information the same
   * colour as five that do not. Weight is what a primary button needs, and ink
   * has more of it than any hue does.
   *
   * `tint` still overrides it, because an artwork-derived colour on a control
   * that belongs to *that show* is the one case where the colour is the
   * information.
   */
  const variants = {
    primary: 'bg-[var(--color-ink)] text-[var(--color-text-on-ink)] border-transparent',
    secondary:
      'bg-transparent text-[var(--color-text-primary)] border-[var(--color-border-strong)] hover:bg-[var(--color-surface-hover)]',
    ghost:
      'bg-transparent text-[var(--color-text-secondary)] border-transparent hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]',
  };

  return (
    <button
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={[...base, variants[variant]].join(' ')}
      style={
        variant === 'primary' && tint
          ? { backgroundColor: tint, color: 'var(--color-text-on-accent)' }
          : undefined
      }
    >
      {children}
    </button>
  );
}
