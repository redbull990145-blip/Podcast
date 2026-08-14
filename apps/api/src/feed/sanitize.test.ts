import { describe, expect, it } from 'vitest';
import { sanitizeShowNotes } from './sanitize.ts';

/**
 * Show notes are arbitrary HTML from strangers. These are the cases that turn
 * a summary into a stored XSS, so they are asserted rather than assumed.
 */
describe('sanitizeShowNotes', () => {
  it('keeps the markup show notes are actually made of', () => {
    const clean = sanitizeShowNotes(
      '<p>With <strong>Ezra</strong> and <em>Lydia</em>.</p><ul><li>One</li></ul>',
    );

    expect(clean).toBe(
      '<p>With <strong>Ezra</strong> and <em>Lydia</em>.</p><ul><li>One</li></ul>',
    );
  });

  it('removes a script tag and its contents', () => {
    const clean = sanitizeShowNotes('<p>Notes</p><script>steal(document.cookie)</script>');

    expect(clean).toBe('<p>Notes</p>');
    expect(clean).not.toContain('steal');
  });

  it('strips inline event handlers', () => {
    const clean = sanitizeShowNotes('<p onclick="steal()">Notes</p>');

    expect(clean).toBe('<p>Notes</p>');
  });

  it('drops a javascript: link but keeps its text', () => {
    const clean = sanitizeShowNotes('<a href="javascript:steal()">Our sponsor</a>');

    // The words survive; only the dangerous href goes. Deleting the text would
    // silently remove content the publisher wrote.
    expect(clean).toContain('Our sponsor');
    expect(clean).not.toContain('javascript:');
  });

  it('rejects a data: URL', () => {
    const clean = sanitizeShowNotes(
      '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">Read more</a>',
    );

    expect(clean).not.toContain('data:');
  });

  it('marks outbound links noopener', () => {
    const clean = sanitizeShowNotes('<a href="https://example.com">Sponsor</a>');

    // Without noopener the opened page can navigate the tab it came from.
    expect(clean).toContain('rel="noopener noreferrer nofollow"');
    expect(clean).toContain('target="_blank"');
  });

  it('refuses a protocol-relative href', () => {
    // It would inherit our scheme — a redirect nobody agreed to.
    const clean = sanitizeShowNotes('<a href="//evil.example/x">Link</a>');

    expect(clean).not.toContain('//evil.example');
  });

  it('removes an iframe entirely', () => {
    const clean = sanitizeShowNotes('<p>A</p><iframe src="https://evil.example"></iframe>');

    expect(clean).toBe('<p>A</p>');
  });

  it('keeps the text inside tags it does not allow', () => {
    // Publishers wrap notes in <div> and <span> constantly; discarding the
    // contents would delete half of some episodes' descriptions.
    const clean = sanitizeShowNotes('<div><span>Everything you need.</span></div>');

    expect(clean).toBe('Everything you need.');
  });

  it('returns null for notes that were entirely markup', () => {
    // "No notes" and "notes that sanitised to nothing" must render the same —
    // as nothing, rather than as an empty box.
    expect(sanitizeShowNotes('<script>steal()</script>')).toBeNull();
  });

  it('passes null through', () => {
    expect(sanitizeShowNotes(null)).toBeNull();
  });

  it('survives unclosed tags rather than throwing', () => {
    // Feeds are hostile by accident before they are hostile on purpose.
    expect(() => sanitizeShowNotes('<p>Half a tag <strong>here')).not.toThrow();
  });
});
