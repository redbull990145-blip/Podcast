'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * Whether an element is anywhere near the viewport.
 *
 * The reason this exists is that following the audio is not free. A panel that
 * tracks the playhead runs a `requestAnimationFrame` loop, sets React state
 * every time the spoken line changes, and re-renders a list that can be nine
 * hundred elements long — and it does all of that whether or not anyone can see
 * it. On the episode page that cost was being paid twice over: the page's own
 * transcript and the player's caption column both follow the same audio through
 * the same transcript, and only one of them is ever in front of the reader.
 *
 * Measured on an episode with 824 cues, with audio playing: the main thread was
 * busy 66% of the time before the player's captions were even opened, and 85%
 * with them open. Paused, it was 0%. The work was entirely playback-driven and
 * mostly invisible.
 *
 * **A generous margin, deliberately.** Following resumes a full viewport before
 * the panel reaches the screen, so it is already tracking by the time it can be
 * read. A tighter box would save marginally more and let the reader catch the
 * highlight snapping into place, which is worse than the cost it saves.
 *
 * Defaults to true and stays true where `IntersectionObserver` is missing:
 * a panel that renders nothing because a capability check failed is a much worse
 * failure than one that does some work it did not need to.
 */
export function useOnScreen(ref: RefObject<Element | null>, rootMargin = '100% 0px'): boolean {
  const [onScreen, setOnScreen] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setOnScreen(entry.isIntersecting);
      },
      { rootMargin },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin]);

  return onScreen;
}
