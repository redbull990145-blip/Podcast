import { describe, expect, it } from 'vitest';
import { isTimed, looksLikeTranscript, parseHtmlTranscript, parseTranscript } from './transcript.ts';

const VTT = `WEBVTT

00:00:01.000 --> 00:00:04.500
Welcome back to the show.

00:00:04.500 --> 00:00:09.000
<v Alice>Today we are talking about
inflation in Argentina.</v>
`;

const SRT = `1
00:00:01,000 --> 00:00:04,500
Welcome back to the show.

2
00:00:04,500 --> 00:00:09,000
Today we are talking about inflation.
`;

describe('parseTranscript', () => {
  it('reads WebVTT', () => {
    const segments = parseTranscript(VTT);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      index: 0,
      startMs: 1000,
      endMs: 4500,
      text: 'Welcome back to the show.',
    });
  });

  it('reads SRT, whose counters and comma decimals are the only difference', () => {
    const segments = parseTranscript(SRT);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ startMs: 1000, endMs: 4500 });
    // The `1` and `2` counter lines must not become transcript text.
    expect(segments[0]!.text).toBe('Welcome back to the show.');
  });

  it('joins the wrapped lines of a cue back into prose', () => {
    // Caption files wrap for a video overlay. Left wrapped, a transcript reads
    // as a column of fragments rather than as something someone said.
    const [, second] = parseTranscript(VTT);
    expect(second!.text).toBe('Today we are talking about inflation in Argentina.');
  });

  it('lifts a WebVTT voice tag into the speaker field', () => {
    const [, second] = parseTranscript(VTT);
    expect(second!.speaker).toBe('Alice');
    expect(second!.text).not.toContain('<v');
  });

  it('lifts the informal `Name:` prefix most human-edited files use instead', () => {
    const [segment] = parseTranscript(`WEBVTT

00:00:00.000 --> 00:00:02.000
Scott Tolinski: That is wild.
`);
    expect(segment).toMatchObject({ speaker: 'Scott Tolinski', text: 'That is wild.' });
  });

  it('does not mistake mid-sentence punctuation for a speaker', () => {
    const [segment] = parseTranscript(`WEBVTT

00:00:00.000 --> 00:00:02.000
so the thing is: it never worked
`);
    expect(segment!.speaker).toBeNull();
    expect(segment!.text).toBe('so the thing is: it never worked');
  });

  it('strips styling markup without eating the words around it', () => {
    const [segment] = parseTranscript(`WEBVTT

00:00:00.000 --> 00:00:02.000
that was <i>completely</i> <c.loud>wrong</c>
`);
    expect(segment!.text).toBe('that was completely wrong');
  });

  it('treats a short fraction as tenths and hundredths, not milliseconds', () => {
    // `.5` is 500ms. Read as 5ms it would put the cue nearly half a second
    // early — audible against speech, and it compounds across a file.
    const [segment] = parseTranscript(`WEBVTT

00:00:01.5 --> 00:00:02.25
half a second in
`);
    expect(segment).toMatchObject({ startMs: 1500, endMs: 2250 });
  });

  it('accepts timestamps with the hour omitted', () => {
    const [segment] = parseTranscript(`WEBVTT

01:02.000 --> 01:05.000
just over a minute
`);
    expect(segment).toMatchObject({ startMs: 62_000, endMs: 65_000 });
  });

  it('parses hours past ten, where a two-digit assumption would break', () => {
    const [segment] = parseTranscript(`WEBVTT

100:00:00.000 --> 100:00:01.000
a very long show
`);
    expect(segment!.startMs).toBe(360_000_000);
  });

  it('keeps every readable cue when one in the middle is corrupt', () => {
    // The whole point: a two-hour transcript must not be lost to one bad line.
    const segments = parseTranscript(`WEBVTT

00:00:01.000 --> 00:00:02.000
first

not a timestamp at all
orphaned text

00:00:03.000 --> 00:00:04.000
third
`);
    expect(segments.map((s) => s.text)).toEqual(['first', 'third']);
  });

  it('drops a cue that ends before it starts', () => {
    // Corrupt timing would break the binary search that finds the active line.
    expect(parseTranscript(`WEBVTT

00:00:09.000 --> 00:00:02.000
backwards
`)).toEqual([]);
  });

  it('drops cues with timing but no words', () => {
    expect(parseTranscript(`WEBVTT

00:00:01.000 --> 00:00:02.000

00:00:03.000 --> 00:00:04.000
real
`).map((s) => s.text)).toEqual(['real']);
  });

  it('sorts out-of-order cues and renumbers them', () => {
    const segments = parseTranscript(`WEBVTT

00:00:09.000 --> 00:00:10.000
later

00:00:01.000 --> 00:00:02.000
earlier
`);
    expect(segments.map((s) => s.text)).toEqual(['earlier', 'later']);
    expect(segments.map((s) => s.index)).toEqual([0, 1]);
  });

  it('survives CRLF line endings and a byte-order mark', () => {
    // Both arrive constantly from Windows tooling, and either one breaks a
    // naive split on '\n\n'.
    const segments = parseTranscript('\uFEFFWEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nhello\r\n');
    expect(segments).toHaveLength(1);
    expect(segments[0]!.text).toBe('hello');
  });

  it('ignores a VTT cue identifier line', () => {
    const [segment] = parseTranscript(`WEBVTT

intro-cue
00:00:01.000 --> 00:00:02.000
hello
`);
    expect(segment!.text).toBe('hello');
  });

  it('returns nothing for a file that is not captions', () => {
    expect(parseTranscript('<html><body>Not found</body></html>')).toEqual([]);
  });
});

describe('parseHtmlTranscript', () => {
  // The shape publishers actually ship. Across the whole seeded catalogue,
  // every `<podcast:transcript>` is text/html and not one is VTT or SRT.
  const HTML = `<!DOCTYPE html><html><head><title>T</title></head><body>
    <cite>Jerod Santo:</cite>
    <p>What up, nerds? I&#39;m Jerod.</p>
    <p>This week&#39;s issue is <em>packed</em>.</p>
    <cite>Adam Stacoviak:</cite>
    <p>Let&#39;s get into it.</p>
  </body></html>`;

  it('reads speaker-and-paragraph prose', () => {
    const segments = parseHtmlTranscript(HTML);
    expect(segments).toHaveLength(3);
    expect(segments[0]).toMatchObject({
      speaker: 'Jerod Santo',
      text: "What up, nerds? I'm Jerod.",
    });
  });

  it('keeps a speaker across their following paragraphs', () => {
    // A `<cite>` introduces everything until the next one, so clearing it after
    // one paragraph would leave most of a transcript unattributed.
    expect(parseHtmlTranscript(HTML)[1]!.speaker).toBe('Jerod Santo');
    expect(parseHtmlTranscript(HTML)[2]!.speaker).toBe('Adam Stacoviak');
  });

  it('drops the colon that belongs to the layout rather than the name', () => {
    expect(parseHtmlTranscript(HTML)[0]!.speaker).not.toContain(':');
  });

  it('carries no timings, which is what makes it unfollowable', () => {
    for (const segment of parseHtmlTranscript(HTML)) {
      expect(segment.startMs).toBe(0);
      expect(segment.endMs).toBe(0);
    }
    expect(isTimed(parseHtmlTranscript(HTML))).toBe(false);
  });

  it('flattens Markdown links to the words that were actually spoken', () => {
    // Publishers put Markdown inside their HTML. The URL was never read out.
    const [segment] = parseHtmlTranscript(
      '<body><p>Read [the announcement](https://example.com/a-very-long-url) today.</p></body>',
    );
    expect(segment!.text).toBe('Read the announcement today.');
  });

  it('ignores markup outside the transcript body', () => {
    const segments = parseHtmlTranscript(
      '<html><head><title>Ignore me</title></head><body><p>Kept.</p></body></html>',
    );
    expect(segments.map((s) => s.text)).toEqual(['Kept.']);
  });

  it('returns nothing for a page with no prose to take', () => {
    expect(parseHtmlTranscript('<body><div>404</div></body>')).toEqual([]);
  });
});

describe('isTimed', () => {
  it('is true once any cue has a real end time', () => {
    expect(isTimed(parseTranscript(VTT))).toBe(true);
  });

  it('is false for an empty transcript', () => {
    expect(isTimed([])).toBe(false);
  });
});

describe('looksLikeTranscript', () => {
  it('recognises captions before a full parse is spent on them', () => {
    expect(looksLikeTranscript(SRT)).toBe(true);
  });

  it('rejects an error page served with a 200', () => {
    // Publishers' CDNs do this constantly, and the content type lies too.
    expect(looksLikeTranscript('<!doctype html><title>404</title>')).toBe(false);
  });
});
