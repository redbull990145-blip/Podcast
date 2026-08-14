import sanitizeHtml from 'sanitize-html';

/**
 * Cleaning publisher show notes.
 *
 * Show notes are arbitrary HTML written by strangers and fetched over the
 * network — the textbook definition of untrusted input. Rendering them raw is
 * a stored cross-site scripting hole: one hostile feed, and every listener who
 * opens that episode runs the publisher's JavaScript on our origin, with their
 * session attached.
 *
 * It happens **once at ingest** rather than per render. Sanitising on the way
 * in means every consumer — the web app, the Android app, and anything added
 * later — is safe by default rather than safe only if it remembered. The cost
 * is that the original markup is not kept, which is the right trade: nothing
 * downstream has a legitimate use for a `<script>` a publisher put in an
 * episode summary.
 *
 * This wraps a library rather than matching tags with a regular expression.
 * HTML sanitisers are a well-known place to be quietly wrong — mutation XSS,
 * unclosed tags, `javascript:` URLs hidden behind entities — and being
 * approximately right here is the same as being wrong.
 */

/**
 * What show notes legitimately contain: prose, links, lists, emphasis, and the
 * occasional heading. Everything else — images, iframes, styles, tables,
 * scripts — is either an attack surface or a layout the reader did not ask for.
 */
const ALLOWED_TAGS = [
  'p',
  'br',
  'a',
  'em',
  'i',
  'strong',
  'b',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'h3',
  'h4',
  'h5',
  'h6',
];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  // Only links carry attributes, and only the ones a link needs. `target` and
  // `rel` are listed because attribute filtering runs *after* `transformTags`
  // below — omit them and the hardening it adds is silently stripped again.
  allowedAttributes: { a: ['href', 'title', 'target', 'rel'] },
  // `javascript:` and `data:` URLs are how a link becomes a script.
  allowedSchemes: ['http', 'https', 'mailto'],
  // A protocol-relative href inherits ours, which for a feed link is never
  // what the publisher meant and is a redirect we did not agree to.
  allowProtocolRelative: false,
  // Disallowed tags lose their markup but keep their text: dropping the
  // contents of a stray <div> would silently delete half of some publishers'
  // notes.
  disallowedTagsMode: 'discard',
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...attribs,
        // Show-note links point off-site by definition; opening them in place
        // would interrupt playback on the web.
        target: '_blank',
        // `noopener` denies the opened page access to `window.opener`.
        // Without it a link in a feed can navigate the tab it came from.
        rel: 'noopener noreferrer nofollow',
      },
    }),
  },
};

/**
 * Sanitise show-note HTML, or return null if nothing survives.
 *
 * Null rather than an empty string, because "this episode has no notes" and
 * "this episode's notes were entirely markup" should render identically — as
 * nothing, rather than as an empty box.
 */
export function sanitizeShowNotes(html: string | null): string | null {
  if (html === null) return null;

  const clean = sanitizeHtml(html, OPTIONS).trim();
  return clean.length > 0 ? clean : null;
}
