import { describe, expect, it } from 'vitest';
import {
  isTimed,
  looksLikeTranscript,
  parseHtmlTranscript,
  parseTranscript,
  timestampMapOffset,
} from './transcript.ts';

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

/**
 * The defects that made publisher transcripts drift.
 *
 * Each of these produced a transcript that loaded, looked plausible, and was
 * wrong — which is the failure mode that reaches users as "it doesn't sync"
 * rather than as an error.
 */
describe('timestampMapOffset', () => {
  it('reads the offset an HLS-derived file declares', () => {
    // MPEGTS 900000 / 90kHz = 10s. Every cue is 10s early without this.
    expect(
      timestampMapOffset('WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000\n'),
    ).toBe(10_000);
  });

  it('subtracts the LOCAL anchor the map is relative to', () => {
    expect(
      timestampMapOffset('WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:04.000,MPEGTS:900000\n'),
    ).toBe(6000);
  });

  it('is zero when there is no map, which is the common case', () => {
    expect(timestampMapOffset('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi\n')).toBe(0);
  });

  it('ignores a map that would move cues before the episode started', () => {
    expect(
      timestampMapOffset('WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:30.000,MPEGTS:900000\n'),
    ).toBe(0);
  });

  it('applies the offset to every parsed cue', () => {
    const segments = parseTranscript(
      'WEBVTT\nX-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000\n\n' +
        '00:00:30.000 --> 00:00:33.000\nthirty seconds in\n',
    );
    expect(segments[0]).toMatchObject({ startMs: 40_000, endMs: 43_000 });
  });
});

describe('parseTranscript resilience', () => {
  it('recovers every cue when a blank line is missing', () => {
    // One absent blank line used to collapse the whole rest of the file into
    // cue #1, with the later timestamps rendered as its caption text.
    const segments = parseTranscript(
      'WEBVTT\n\n' +
        '00:00:01.000 --> 00:00:02.000\nfirst\n' +
        '00:00:03.000 --> 00:00:04.000\nsecond\n' +
        '00:00:05.000 --> 00:00:06.000\nthird\n',
    );

    expect(segments.map((s) => s.text)).toEqual(['first', 'second', 'third']);
    expect(segments.map((s) => s.startMs)).toEqual([1000, 3000, 5000]);
  });

  it('does not leave a timestamp inside the caption text', () => {
    const segments = parseTranscript(
      'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nfirst\n00:00:03.000 --> 00:00:04.000\nsecond\n',
    );
    for (const segment of segments) expect(segment.text).not.toMatch(/-->/);
  });

  it('strips an SRT counter that follows a run-together cue', () => {
    const segments = parseTranscript(
      '1\n00:00:01,000 --> 00:00:02,000\nfirst\n2\n00:00:03,000 --> 00:00:04,000\nsecond\n',
    );
    expect(segments.map((s) => s.text)).toEqual(['first', 'second']);
  });

  it('accepts a timestamp with no fractional part', () => {
    const segments = parseTranscript('WEBVTT\n\n00:00:01 --> 00:00:04\nno fraction\n');
    expect(segments[0]).toMatchObject({ startMs: 1000, endMs: 4000, text: 'no fraction' });
  });

  it('accepts microsecond precision rather than dropping the cue', () => {
    // ffmpeg and several Whisper wrappers emit six digits. The strict form did
    // not round these — it failed to match at all and lost the line.
    const segments = parseTranscript(
      'WEBVTT\n\n00:00:01.500000 --> 00:00:02.000000\nsix digits\n',
    );
    expect(segments[0]).toMatchObject({ startMs: 1500, endMs: 2000 });
  });
});

describe('isTimed', () => {
  const cue = (startMs: number, endMs: number, index: number) => ({
    index,
    startMs,
    endMs,
    text: 'x',
    speaker: null,
  });

  it('accepts timings that advance', () => {
    expect(isTimed([cue(0, 2000, 0), cue(2000, 4000, 1)])).toBe(true);
  });

  it('rejects a file where every cue starts at zero', () => {
    // A broken exporter writing real ends against identical starts. The
    // rightmost-match search would pin the highlight to the final line for the
    // entire episode, which looks broken rather than untimed.
    expect(isTimed([cue(0, 2000, 0), cue(0, 5000, 1), cue(0, 9000, 2)])).toBe(false);
  });

  it('rejects prose with no timings at all', () => {
    expect(isTimed([cue(0, 0, 0), cue(0, 0, 1)])).toBe(false);
  });

  it('rejects a single cue, which has no timeline to follow', () => {
    expect(isTimed([cue(0, 9000, 0)])).toBe(false);
  });
});

describe('looksLikeTranscript', () => {
  it('recognises a WebVTT file, whose first line is never a cue', () => {
    expect(looksLikeTranscript('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhi\n')).toBe(true);
  });

  it('recognises SRT', () => {
    expect(looksLikeTranscript('1\n00:00:01,000 --> 00:00:02,000\nhi\n')).toBe(true);
  });

  /**
   * The regression this exists for. `-->` also closes an HTML comment, and
   * publisher transcripts are overwhelmingly HTML pages carrying analytics
   * comments — so they were routed to the caption parser, yielded nothing, and
   * were cached as failures for a day.
   */
  it('is not fooled by an HTML comment', () => {
    const page =
      '<html><head><!-- Google Tag Manager --></head><body>' +
      '<cite>Jerod Santo:</cite><p>What up, nerds?</p></body></html>';
    expect(looksLikeTranscript(page)).toBe(false);
    // ...and the HTML parser makes sense of it, which is the whole point.
    expect(parseHtmlTranscript(page).length).toBeGreaterThan(0);
  });

  it('ignores prose that merely contains an arrow', () => {
    expect(looksLikeTranscript('<p>Revenue --> profit, eventually.</p>')).toBe(false);
  });
});
