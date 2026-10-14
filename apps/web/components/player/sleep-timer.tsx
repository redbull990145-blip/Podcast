'use client';

import { icon } from '@cue/design';
import { useTranslator } from '@/components/i18n/locale-provider';
import { usePlayerActions, usePlayerSelector } from '@/lib/player/store';

/**
 * Stop playing, some time after I have stopped listening.
 *
 * **The feature was already built.** `PlayerMachine` has carried `sleepAtMs`,
 * `setSleepTimer()` and a deadline check on the position tick for as long as
 * the player has existed, the store exposes it as an action, and the message
 * catalogue has had `player.sleepTimer`, `player.sleepOff`,
 * `player.sleepMinutes` and `player.stoppingAt` in four languages. What it never
 * had was a control: nothing in the web app called any of it, so a working,
 * tested, translated feature was unreachable. This is only the surface.
 *
 * A wall-clock deadline rather than a countdown, which is the machine's
 * decision and the right one — a JS timer drifts when the tab is backgrounded
 * or the phone sleeps, and that is precisely when a sleep timer is running.
 *
 * The options stop at an hour. Past that this is not a sleep timer, it is a
 * decision to listen to the whole thing, and the player already does that.
 */
export const SLEEP_OPTIONS = [5, 10, 15, 30, 45, 60] as const;

/**
 * How the deadline is written out.
 *
 * The *time it will stop*, not the minutes remaining — those are two different
 * facts and only one of them survives being read once. "Stopping at 23:40" is
 * still true in five minutes; "25 min left" is a number that has to be
 * re-rendered every minute to stay honest, which is a per-minute re-render of
 * the player to move a label nobody is watching.
 */
function useDeadline(): { sleepAtMs: number | null; minutesLeft: number | null } {
  const sleepAtMs = usePlayerSelector((state) => state.sleepAtMs);
  return {
    sleepAtMs,
    minutesLeft:
      sleepAtMs === null ? null : Math.max(0, Math.round((sleepAtMs - Date.now()) / 60_000)),
  };
}

/**
 * The options, as a radio group.
 *
 * Shared verbatim by Settings and the player rather than written twice, for the
 * reason the speed control gives about its own scale: two controls for one
 * setting drift, and the one that drifts is the one you look at less.
 */
export function SleepTimerChoices({ onPick }: { onPick?: () => void }) {
  const t = useTranslator();
  const actions = usePlayerActions();
  const { sleepAtMs } = useDeadline();

  const choose = (minutes: number | null) => {
    actions.setSleepTimer(minutes);
    onPick?.();
  };

  const options: { value: number | null; label: string }[] = [
    { value: null, label: t.t('player.sleepOff') },
    ...SLEEP_OPTIONS.map((minutes) => ({
      value: minutes,
      label: t.t('player.sleepMinutes', { count: minutes }),
    })),
  ];

  return (
    <div role="radiogroup" aria-label={t.t('player.sleepTimer')} className="flex flex-wrap gap-2">
      {options.map((option) => {
        // "Off" is selected precisely when nothing is armed. The timed options
        // are never re-selected from the deadline, because 30 minutes ago is not
        // a thing the machine remembers — it stores *when*, not *how long*.
        const active = option.value === null ? sleepAtMs === null : false;

        return (
          <button
            key={option.value ?? 'off'}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => choose(option.value)}
            /*
              `radius-md`, not the pill DESIGN.md specifies for controls.

              Deliberate, and worth writing down because it reads as a
              violation. This row sits directly beneath Skip back and Skip
              forward, which are the same kind of segmented selector and have
              always been drawn square-ish — three groups of the same control in
              one section disagreeing about their corners is a louder mistake
              than one group disagreeing with a rule. The rule and those three
              controls should be reconciled together, in one pass, rather than
              by making this the odd one out in the other direction.
            */
            className="type-caption min-h-11 min-w-11 cursor-pointer rounded-[var(--radius-md)] border px-3.5 transition-[transform,background-color,border-color,color] duration-[var(--duration-instant)] ease-standard hover:bg-[var(--color-surface-hover)] active:scale-[0.97] motion-reduce:active:scale-100"
            style={{
              borderColor: active ? 'var(--color-accent)' : 'var(--color-border)',
              backgroundColor: active ? 'var(--color-accent-muted)' : undefined,
              color: active ? 'var(--color-accent-text)' : 'var(--color-text-secondary)',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * When it will stop, in the reader's own clock format.
 *
 * `Intl` rather than a hand-rolled `HH:MM`, because half the world reads 11:40
 * pm and the other half 23:40, and a sleep timer is read in the dark by
 * somebody who is already half asleep.
 */
export function SleepTimerStatus({ className }: { className?: string }) {
  const t = useTranslator();
  const { sleepAtMs } = useDeadline();

  if (sleepAtMs === null) return null;

  const time = new Intl.DateTimeFormat(t.locale, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(sleepAtMs);

  return (
    <p className={['type-caption m-0 text-[var(--color-text-secondary)]', className ?? ''].join(' ')}>
      {t.t('player.stoppingAt', { time })}
    </p>
  );
}

/**
 * The moon, and the minutes when it is armed.
 *
 * A disclosure rather than a portalled menu. The speed control next to it is a
 * portal because it carries a slider and has to escape a 40px row; this is
 * seven pills that fit on one line under the transport, and the sheet has the
 * vertical room. It is also the pattern `CaptionSync` already uses in the
 * column beside it — quiet until pressed, then a row of controls in place.
 */
export function SleepTimerButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTranslator();
  const { sleepAtMs, minutesLeft } = useDeadline();
  const armed = sleepAtMs !== null;

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={t.t('player.sleepTimer')}
      aria-expanded={open}
      aria-pressed={armed}
      className={[
        'flex h-10 min-w-10 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-full border-0 px-2',
        'transition-colors',
        open || armed
          ? 'bg-[var(--color-surface-hover)] text-[var(--color-text-primary)]'
          : 'bg-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]',
      ].join(' ')}
    >
      <svg
        width="19"
        height="19"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={icon.sleep} />
      </svg>

      {/* The number rides beside the moon while it is armed, so the state is
          legible without opening anything — and it is a *number*, not a colour,
          which is what keeps the armed state readable to somebody who does not
          separate the two fills. */}
      {armed && minutesLeft !== null ? (
        <span className="cue-button type-timecode leading-none">{minutesLeft}</span>
      ) : null}
    </button>
  );
}
