'use client';

import { deriveTint } from '@cue/design';
import { useMotionValueEvent, type MotionValue } from 'motion/react';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import styles from './ambient-backdrop.module.css';

/** Tiny source: the backdrop needs color shapes, never full-resolution detail. */
function blurSource(artworkUrl: string): string {
  return `/_next/image?url=${encodeURIComponent(artworkUrl)}&w=64&q=75`;
}

/**
 * Slow drifting artwork and an independently breathing extracted-color wash.
 * Only transforms and opacity animate; the blur and gradients are painted once.
 * A fixed scrim keeps the controls readable throughout every phase of motion.
 */
export const AmbientBackdrop = memo(function AmbientBackdrop({
  artworkUrl,
  accentColor,
  active = true,
  expansion,
}: {
  artworkUrl: string | null;
  accentColor: string | null;
  active?: boolean;
  expansion: MotionValue<number>;
}) {
  const tint = useMemo(
    () => (accentColor ? deriveTint(accentColor, 'dark') : null),
    [accentColor],
  );
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(() => expansion.get() > 0.001);
  const mountedRef = useRef(mounted);

  useMotionValueEvent(expansion, 'change', (value) => {
    const next = value > 0.001;
    if (next === mountedRef.current) return;
    mountedRef.current = next;
    setMounted(next);
  });

  useEffect(() => {
    if (!mounted) return;
    const update = () => setVisible(document.visibilityState === 'visible');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [mounted]);

  // No gradient textures, image request, or hidden ambient layers at mini
  // height. Keep them until the closing fade actually reaches its destination.
  if (!mounted) return null;

  return (
    <div
      aria-hidden="true"
      data-ambient-backdrop="true"
      data-moving={active && visible ? 'true' : 'false'}
      className={`${styles['backdrop']} pointer-events-none absolute inset-0 overflow-hidden`}
    >
      <div className="absolute inset-0 bg-[var(--color-bg)]" />
      {artworkUrl ? (
        <div
          className={styles['artwork']}
          style={{ backgroundImage: `url(${blurSource(artworkUrl)})` }}
        />
      ) : null}
      {tint ? (
        <>
          <div
            className={styles['wash']}
            style={{
              background: `radial-gradient(ellipse at 30% 28%, ${tint.fill}B3 0%, ${tint.fill}40 35%, transparent 70%)`,
            }}
          />
          <div
            className={styles['echo']}
            style={{
              background: `radial-gradient(ellipse at 75% 68%, ${tint.text}66, transparent 65%)`,
            }}
          />
        </>
      ) : null}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, rgb(0 0 0 / 0.28) 0%, rgb(0 0 0 / 0.48) 45%, rgb(0 0 0 / 0.78) 100%)',
        }}
      />
    </div>
  );
});
