/**
 * Parsing `<itunes:duration>`.
 *
 * The spec says seconds. Publishers write `3600`, `1:00:00`, `60:00`,
 * `01:00:00.500`, `1h 2m`, and occasionally `--`. Getting this wrong is
 * visible: a wrong duration means a wrong progress bar and a "45 minutes left"
 * label on a 20-minute episode.
 *
 * Returning null is a real answer. A feed that omits duration is normal, and
 * the player learns the true value on load — inventing a zero would render a
 * broken scrubber.
 */

const MAX_PLAUSIBLE_SEC = 24 * 60 * 60;

export function parseDuration(input: unknown): number | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) && input > 0 && input <= MAX_PLAUSIBLE_SEC
      ? Math.round(input)
      : null;
  }

  if (typeof input !== 'string') return null;

  const value = input.trim();
  if (value.length === 0) return null;

  // `1h 2m 3s`, `90m`, `1h30m`
  if (/^[\d\s.hms]+$/i.test(value) && /[hms]/i.test(value)) {
    const hours = /(\d+(?:\.\d+)?)\s*h/i.exec(value);
    const minutes = /(\d+(?:\.\d+)?)\s*m/i.exec(value);
    const seconds = /(\d+(?:\.\d+)?)\s*s/i.exec(value);

    if (hours ?? minutes ?? seconds) {
      const total =
        Number(hours?.[1] ?? 0) * 3600 + Number(minutes?.[1] ?? 0) * 60 + Number(seconds?.[1] ?? 0);
      return total > 0 && total <= MAX_PLAUSIBLE_SEC ? Math.round(total) : null;
    }
  }

  // `HH:MM:SS`, `MM:SS`, with optional fractional seconds.
  if (value.includes(':')) {
    const parts = value.split(':');
    if (parts.length > 3) return null;

    let total = 0;
    for (const part of parts) {
      const trimmed = part.trim();
      // Reject `1:2x:00` rather than letting Number() coerce something odd.
      if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
      total = total * 60 + Number(trimmed);
    }

    return total > 0 && total <= MAX_PLAUSIBLE_SEC ? Math.round(total) : null;
  }

  // Plain seconds.
  if (/^\d+(\.\d+)?$/.test(value)) {
    const total = Number(value);
    return total > 0 && total <= MAX_PLAUSIBLE_SEC ? Math.round(total) : null;
  }

  return null;
}
