'use client';

import { useEffect, useRef, type RefObject } from 'react';

/**
 * The keyboard half of a modal surface.
 *
 * The expanded player already behaved like a modal in every way a mouse can
 * tell — it scrims the page, locks the document's scroll and takes the
 * scrollbar's width with it, and closes on Escape. What it never did was say so
 * to a keyboard or a screen reader, and the gap was not cosmetic: measured on a
 * 1440px window with an episode playing and the player *collapsed*, the sheet
 * held 662 focusable elements — a complete second transport, plus every line of
 * a 651-cue transcript — sitting off-screen at `opacity: 0` and still in the tab
 * order. `pointer-events: none` removes none of that; it is a pointer
 * instruction, and a keyboard is not a pointer.
 *
 * So this is deliberately three separate jobs, and the sheet needs all three:
 *
 *  - **`inert` on the sheet while it is closed** — applied by the caller, not
 *    here, because it belongs on the element rather than to an effect. That is
 *    what deletes the ghost tab stops.
 *  - **`inert` on everything else while it is open** — also the caller's, for
 *    the same reason. The rail, the page and the tab bar are the player's
 *    siblings, not its children, so nothing here can reach them.
 *  - **Focus containment while it is open** — this hook. Focus moves in on
 *    open, wraps at both ends, is pulled back if it escapes, and returns to
 *    whatever opened the sheet on close.
 *
 * Split that way because the first two are declarative and free, and only the
 * last one needs to listen to anything.
 */

/**
 * What a keyboard can land on.
 *
 * `[role="slider"]` is in the list because this app's scrubber and volume
 * control are divs with `tabIndex` driven by whether they are seekable — the
 * `[tabindex]` clause already catches them, and naming the role as well is what
 * keeps the list honest if that ever becomes a real `<input type="range">`.
 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useModalSheet({
  open,
  onClose,
  containerRef,
}: {
  open: boolean;
  onClose: () => void;
  containerRef: RefObject<HTMLElement | null>;
}): void {
  /**
   * Held in a ref rather than taken as a dependency.
   *
   * The caller's handler is almost always an inline `() => setExpanded(false)`,
   * which is a new function on every render — and this effect *moves focus*, so
   * re-running it on every render would drag the caret back to the first control
   * of the sheet several times a second while anything is playing.
   */
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    const restoreTo = document.activeElement as HTMLElement | null;

    /*
      Focus lands a frame later, deliberately.

      The sheet is mid-spring when this runs and its controls are laid out from
      a measured column width, so the first focusable element either does not
      exist yet or is about to move. Waiting one frame is the difference between
      focusing the transport and focusing whatever happened to be first before
      the layout settled.
    */
    const frame = requestAnimationFrame(() => {
      const target = focusable(container)[0] ?? container;
      target.focus({ preventScroll: true });
    });

    const onKey = (event: KeyboardEvent) => {
      // A portal dialog has its own keyboard scope even outside our DOM tree.
      const inner = (event.target as Element | null)?.closest?.('[role="dialog"]');
      if (inner && inner !== container) return;
      if (event.key === 'Escape') {
        /*
          A popover inside the sheet owns Escape while it is open.

          The speed panel is a real `role="dialog"` with its own document-level
          Escape handler, and it is a *child* of this sheet — so without this
          check, one press would close both and the panel would appear to have
          taken the whole player down with it. Reading the role off the event's
          own target is what tells the two cases apart: the panel moves focus
          into itself when it opens, so a press aimed at it originates inside it.

          Deliberately not solved with `stopPropagation` in the capture phase,
          which is the reflex and is worse — it would silence the panel's own
          handler rather than deferring to it.
        */
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const items = focusable(container);
      if (items.length === 0) {
        // Nothing to hold focus on, so hold it on nothing rather than letting
        // Tab walk out into a page that is inert anyway.
        event.preventDefault();
        return;
      }

      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      // Focus can be *outside* as well as at an edge: opening the sheet from a
      // drag never moves it in, and the browser's address bar hands it back to
      // `<body>`. Both cases have to be pulled in rather than wrapped.
      const outside = !container.contains(active);

      if (event.shiftKey ? active === first || outside : active === last || outside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };

    document.addEventListener('keydown', onKey);

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);

      /*
        Returned only if the sheet still had it.

        Something else may have deliberately taken focus while the player was
        open — following a link out of the queue panel, most obviously — and
        yanking it back to the mini bar afterwards would undo a navigation the
        listener asked for.
      */
      if (restoreTo?.isConnected && container.contains(document.activeElement)) {
        restoreTo.focus({ preventScroll: true });
      }
    };
  }, [open, containerRef]);
}

/**
 * The focusable elements actually reachable inside `container`.
 *
 * `getClientRects()` rather than `offsetParent`, which is the more common test
 * and is wrong here: `offsetParent` is null for anything `position: fixed`, and
 * this sheet is fixed. An empty rect list is the honest "not rendered" signal
 * for both.
 *
 * `[inert]` subtrees are filtered explicitly because `querySelectorAll` does not
 * know about them — the browser will refuse to focus those elements, so leaving
 * one at the end of the list would make Tab appear to do nothing at the edge.
 */
function focusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => element.getClientRects().length > 0 && !element.closest('[inert]'),
  );
}
