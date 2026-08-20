'use client';

import { dark, light, onyx, type ColorScheme } from '@cue/design';
import type { MessageKey } from '@cue/i18n';
import { useTranslator } from '@/components/i18n/locale-provider';
import { applyTheme, useThemeChoice, type ThemeChoice } from '@/lib/theme';

/**
 * Every scheme, as things you can look at.
 *
 * A radio group of the word "Onyx" asks somebody to choose between two darks by
 * reading their names, which is a quiz. Each option draws itself out of the
 * palette it selects — ground, surface, text, accent — so the difference
 * between warm and neutral is visible in the control rather than described by
 * it, and the choice takes about as long as noticing which one you prefer.
 *
 * The swatches are painted from the imported token objects, not from hex
 * literals typed in here. A preview that can drift from the theme it previews
 * is worse than no preview: it is a control that lies about what it does.
 */

type Option = {
  value: ThemeChoice;
  label: MessageKey;
  caption: MessageKey;
  /** `null` for System — it has no palette of its own to draw. */
  scheme: ColorScheme | null;
};

/**
 * System first, because it is the default and the one that needs no decision.
 * Then light, then the two darks adjacent to each other — they are variants of
 * one idea and comparing them is the only reason this control is four wide
 * rather than three.
 */
const OPTIONS: Option[] = [
  { value: 'system', label: 'theme.system', caption: 'theme.systemHint', scheme: null },
  { value: 'light', label: 'theme.light', caption: 'theme.lightHint', scheme: light },
  { value: 'dark', label: 'theme.ember', caption: 'theme.emberHint', scheme: dark },
  { value: 'onyx', label: 'theme.onyx', caption: 'theme.onyxHint', scheme: onyx },
];

export function ThemePicker() {
  const t = useTranslator();
  const choice = useThemeChoice();

  return (
    <div
      role="radiogroup"
      aria-label={t.t('theme.label')}
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      {OPTIONS.map((option) => {
        const active = option.value === choice;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => applyTheme(option.value)}
            className={[
              'flex cursor-pointer flex-col gap-2.5 rounded-[var(--radius-lg)] border p-3 text-start',
              'transition-colors',
              active
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-muted)]'
                : 'border-[var(--color-border)] bg-transparent hover:bg-[var(--color-surface-hover)]',
            ].join(' ')}
          >
            <Swatch scheme={option.scheme} />

            <span className="min-w-0">
              <span
                className={[
                  'type-body-strong block',
                  active
                    ? 'text-[var(--color-accent-text)]'
                    : 'text-[var(--color-text-primary)]',
                ].join(' ')}
              >
                {t.t(option.label)}
              </span>
              <span className="type-caption mt-0.5 block text-[var(--color-text-tertiary)]">
                {t.t(option.caption)}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The theme in miniature: a page, a card on it, two lines of text, an accent.
 *
 * Those four are the whole visible difference between these schemes, and they
 * are drawn in the same relationship they have on a real screen — the card
 * *recessed* into the light ground and raised out of the dark ones, which is
 * the one structural thing about this palette that surprises people.
 *
 * System draws itself in halves. It is not a palette, it is a *deferral*, and
 * the honest picture of "whatever your computer is doing" is both answers at
 * once rather than whichever one happens to be on right now.
 */
function Swatch({ scheme }: { scheme: ColorScheme | null }) {
  if (!scheme) {
    return (
      <span
        aria-hidden="true"
        className="relative block h-14 w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]"
      >
        <span className="absolute inset-0 flex">
          <SwatchFace scheme={light} half />
          <SwatchFace scheme={dark} half />
        </span>
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="relative block h-14 w-full overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]"
    >
      <SwatchFace scheme={scheme} />
    </span>
  );
}

function SwatchFace({ scheme, half = false }: { scheme: ColorScheme; half?: boolean }) {
  return (
    <span
      className={['flex h-full flex-col justify-end gap-1 p-1.5', half ? 'w-1/2' : 'w-full'].join(
        ' ',
      )}
      style={{ backgroundColor: scheme.bg }}
    >
      <span
        className="flex items-center gap-1 rounded-[3px] p-1"
        style={{ backgroundColor: scheme.surface }}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: scheme.accent }}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span
            className="block h-[3px] w-full rounded-full"
            style={{ backgroundColor: scheme.textPrimary }}
          />
          <span
            className="block h-[3px] w-2/3 rounded-full"
            style={{ backgroundColor: scheme.textTertiary }}
          />
        </span>
      </span>
    </span>
  );
}
