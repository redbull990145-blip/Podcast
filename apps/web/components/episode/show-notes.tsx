/**
 * Show notes.
 *
 * The HTML here was sanitised at ingest, in `apps/api/src/feed/sanitize.ts` —
 * once, server-side, on the way in. That is the only reason this component is
 * allowed to use `dangerouslySetInnerHTML` at all: the markup reaching it has
 * already been through an allowlist, so a publisher cannot put a script in an
 * episode summary and have it run on our origin.
 *
 * If you are reading this because you want to render publisher HTML somewhere
 * else: sanitise at the boundary, not here. A second component that trusts raw
 * feed markup would reintroduce exactly the hole that one closes.
 */
export function ShowNotes({ html, text }: { html: string | null; text: string | null }) {
  if (html) {
    return (
      <section aria-label="Show notes" className="max-w-[var(--measure-prose)]">
        <div
          className="show-notes type-body text-[var(--color-text-secondary)]"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </section>
    );
  }

  // Plenty of feeds carry no markup at all, only a plain summary. Rendering
  // that as text is not a fallback so much as the other normal case.
  if (text) {
    return (
      <section aria-label="Show notes" className="max-w-[var(--measure-prose)]">
        <p className="type-body whitespace-pre-line text-[var(--color-text-secondary)]">
          {text}
        </p>
      </section>
    );
  }

  return (
    <p className="type-callout text-[var(--color-text-tertiary)]">
      The publisher didn&rsquo;t include notes for this episode.
    </p>
  );
}
