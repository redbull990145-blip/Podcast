'use client';

import { useEffect } from 'react';
import { readPreferences } from '@/lib/player/preferences';
import { readPosition, usePlayerActions, usePlayerSelector } from '@/lib/player/store';

/**
 * The transport, from the keyboard, anywhere in the app.
 *
 * The player has always been reachable by Tab — every control is a real button
 * with a real label. What it had no answer for is the thing people actually do
 * with a media app on a laptop: press space to pause without first hunting for
 * the bar at the bottom of the window. That is not a convenience so much as the
 * difference between a media player and a page with audio on it.
 *
 * **Nothing here is new capability.** Every binding maps onto an action the
 * store already exposes, so the keyboard cannot reach a state the buttons
 * cannot — which is what keeps the two from drifting and what makes this safe
 * to add late.
 *
 * The bindings are the ones two decades of video and audio players have taught:
 * space toggles, J and L jump back and forward, K toggles as well (a hand
 * resting on J/K/L should not have to move), and the arrows do the same on the
 * other side of the keyboard.
 */

/**
 * When the focused element has already claimed the key.
 *
 * The rule is not "is this a text field" but the broader and more obviously
 * correct one: **a focused control owns its own keys**. Three kinds of thing
 * qualify, and all three are real on this app's screens.
 *
 * *Text*, which is anything typed — the transcript search, the search box, the
 * sign-in form.
 *
 * *Controls with their own key meanings* — the scrubber and the volume track
 * are `role="slider"` and handle their own arrows; a radio group moves its
 * selection with them.
 *
 * *Anything activated by Space or Enter*, which is every button and link in the
 * app. This is the case that made the bug: with the play button focused, Space
 * both activated the button and ran this shortcut, so the player toggled twice
 * and appeared not to respond at all. Deferring is also simply right — someone
 * who has tabbed to a control and pressed Space meant that control, not a
 * global.
 *
 * Modifiers are handled by the caller: ⌘L and Ctrl+L belong to the browser, and
 * stealing them from somebody reaching for their address bar is the fastest way
 * for a shortcut layer to be hated.
 */
function handledByFocusedElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;

  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'BUTTON' || tag === 'SUMMARY') return true;
  if (tag === 'A' && target.hasAttribute('href')) return true;

  const role = target.getAttribute('role');
  return role === 'slider' || role === 'radio' || role === 'button' || role === 'link';
}

export function usePlayerShortcuts(): void {
  const actions = usePlayerActions();
  /*
    Selected rather than the whole snapshot: this hook is mounted in the shell
    for the life of the session, and it needs exactly one fact — whether there
    is anything to control. Subscribing to the state would re-attach the
    listener several times a second while anything plays.
  */
  const hasEpisode = usePlayerSelector((state) => state.current !== null);
  const volume = usePlayerSelector((state) => state.volume);

  useEffect(() => {
    if (!hasEpisode) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (handledByFocusedElement(event.target)) return;

      // Read per press rather than closed over, so changing the skip interval
      // in Settings takes effect without this listener being rebuilt.
      const { skipBackSec, skipForwardSec } = readPreferences();

      /*
        The spacebar is matched on `code` as well as on `key`.

        `key` is the character produced, which is what every other binding here
        wants — `l` should be `l` whatever the layout calls that key. The
        spacebar is the exception: it is a *place on the keyboard* rather than a
        character, and under some layouts and input methods the character it
        produces is not `' '` at all. `code` names the physical key, which is
        the thing a listener is actually reaching for in the dark.
      */
      const isSpace = event.key === ' ' || event.code === 'Space';
      if (isSpace) {
        // Space scrolls the page by default, and a player that pauses *and*
        // jumps you down a screen is worse than one that does neither.
        event.preventDefault();
        actions.toggle();
        return;
      }

      switch (event.key) {
        case 'k':
        case 'K':
          event.preventDefault();
          actions.toggle();
          return;

        case 'j':
        case 'J':
        case 'ArrowLeft':
          event.preventDefault();
          actions.seek(readPosition() - skipBackSec);
          return;

        case 'l':
        case 'L':
        case 'ArrowRight':
          event.preventDefault();
          actions.seek(readPosition() + skipForwardSec);
          return;

        case 'ArrowUp':
          event.preventDefault();
          actions.setVolume(Math.min(1, volume + VOLUME_STEP));
          return;

        case 'ArrowDown':
          event.preventDefault();
          actions.setVolume(Math.max(0, volume - VOLUME_STEP));
          return;

        case 'm':
        case 'M':
          event.preventDefault();
          // Mute is a volume of zero rather than a flag, because that is what
          // the machine models — and unmuting to full is the honest inverse of
          // that, since nothing remembers what it was before.
          actions.setVolume(volume > 0 ? 0 : 1);
          return;

        default:
          return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [actions, hasEpisode, volume]);
}

/** A tenth per press: ten presses from silent to full, which is a fair trade. */
const VOLUME_STEP = 0.1;
