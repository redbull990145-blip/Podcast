'use client';

import { colorVarStyle, tintedScheme } from '@cue/design';
import { AnimatePresence, useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { useEffect, useRef, useState } from 'react';
import { useNowPlayingTint } from '@/lib/now-playing-tint';
import { shouldSweepPodcast } from '@/lib/podcast-transition';
import { usePlayerSelector } from '@/lib/player/store';
import { isLightNow, useThemeChoice } from '@/lib/theme';

const TINT_SECONDS = 1.15;

/** The app follows the playing show. Episodes within it keep the same room. */
export function NowPlayingTint() {
  const enabled = useNowPlayingTint();
  const podcastId = usePlayerSelector((s) => s.current?.podcastId ?? null);
  const color = usePlayerSelector((s) => s.current?.accentColor ?? null);
  const isLight = isLightNow(useThemeChoice());
  const reduced = useReducedMotion();
  const paintedRef = useRef<Record<string, string> | null>(null);
  const previousPodcast = useRef<string | null>(null);
  const [bloom, setBloom] = useState<{ id: number; color: string } | null>(null);
  const bloomId = useRef(0);

  useEffect(() => {
    const root = document.documentElement;
    const scheme = enabled && color ? tintedScheme(color, isLight ? 'light' : 'dark') : null;
    const previous = paintedRef.current;
    const sweep = shouldSweepPodcast(previousPodcast.current, podcastId);
    // Record identity even without a usable color. A delayed artwork response
    // or a theme change must not announce the same show again.
    previousPodcast.current = podcastId;

    if (!scheme) {
      if (previous) {
        for (const property of Object.keys(previous)) root.style.removeProperty(property);
        paintedRef.current = null;
      }
      setBloom(null);
      return;
    }

    const next = colorVarStyle(scheme);
    // One palette write per change. Interpolating inherited custom properties
    // used to restyle/repaint the whole document throughout a two-second fade.
    // The visible transition now belongs only to composited opacity/transform.
    for (const [property, value] of Object.entries(next)) {
      if (previous?.[property] !== value) root.style.setProperty(property, value);
    }
    paintedRef.current = next;

    if (previous && sweep && !reduced && document.visibilityState === 'visible') {
      setBloom({ id: ++bloomId.current, color: scheme.accent });
    } else if (reduced) {
      setBloom(null);
    }
  }, [enabled, podcastId, color, isLight, reduced]);

  useEffect(() => {
    const root = document.documentElement;
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') setBloom(null);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      const painted = paintedRef.current;
      if (painted) {
        for (const property of Object.keys(painted)) root.style.removeProperty(property);
      }
    };
  }, []);

  return (
    <AnimatePresence>
      {bloom ? (
        <m.div
          key={bloom.id}
          aria-hidden="true"
          data-podcast-transition="true"
          className="pointer-events-none fixed inset-0 z-[60]"
          initial={{ opacity: 0, scale: 1.12, y: '8%' }}
          animate={{ opacity: [0, 0.36, 0], scale: [1.12, 1, 1.04], y: ['8%', '0%', '-4%'] }}
          exit={{ opacity: 0 }}
          transition={{ duration: TINT_SECONDS, times: [0, 0.3, 1], ease: 'easeInOut' }}
          onAnimationComplete={() =>
            setBloom((current) => (current?.id === bloom.id ? null : current))
          }
          style={{
            background: `radial-gradient(130% 95% at 50% 100%, ${bloom.color}, transparent 72%)`,
            mixBlendMode: isLight ? 'multiply' : 'screen',
            willChange: 'transform, opacity',
          }}
        />
      ) : null}
    </AnimatePresence>
  );
}
