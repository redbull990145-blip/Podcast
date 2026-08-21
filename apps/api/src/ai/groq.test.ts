import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { partitionWords, transcribe, withRetry } from './groq.ts';

/**
 * The retry that exists because of a real failure.
 *
 * A transcription of an hour-long episode is several sequential 20MB uploads,
 * and a single 502 from Groq's gateway on any one of them threw away every
 * chunk before it and spent the user's daily allowance to produce nothing. The
 * cases below are the whole policy: retry what is transient, surface what is
 * not, and never retry something the caller has abandoned.
 *
 * Fake timers throughout — the backoff is seconds long by design, and a test
 * suite should not wait it out.
 */
describe('withRetry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** Run `promise` to settlement while letting every pending timer fire. */
  async function settle<T>(promise: Promise<T>): Promise<T> {
    // `error?: undefined` on the success arm so the read below does not depend
    // on narrowing, which `strict: false` disables — see url-guard.ts.
    const result: Promise<
      { ok: true; value: T; error?: undefined } | { ok: false; error: unknown }
    > = promise.then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    await vi.runAllTimersAsync();
    const outcome = await result;
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  }

  function response(status: number): Response {
    // A body on every response, so the cancel-before-retry path is exercised
    // rather than skipped by a null body.
    return new Response('{}', { status });
  }

  it('retries a 502 and returns the attempt that works', async () => {
    const send = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(response(502))
      .mockResolvedValueOnce(response(200));

    const result = await settle(withRetry(send));

    expect(result.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('gives up after three attempts and hands back the last response', async () => {
    // The final response is returned rather than thrown so the caller can read
    // Groq's own message out of the body for the error it shows.
    const send = vi.fn<() => Promise<Response>>().mockResolvedValue(response(503));

    const result = await settle(withRetry(send));

    expect(result.status).toBe(503);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('does not retry a rejected key', async () => {
    // 401 will be 401 again. Retrying delays the one message that tells the
    // user their key is wrong.
    const send = vi.fn<() => Promise<Response>>().mockResolvedValue(response(401));

    const result = await settle(withRetry(send));

    expect(result.status).toBe(401);
    expect(send).toHaveBeenCalledTimes(1);
  });

  /**
   * The rate limit is an appointment, not a failure.
   *
   * These replace a test asserting that a 429 was never retried, which encoded
   * the bug rather than a policy: a long episode is several sequential uploads
   * and the free tier's hourly allowance runs out partway through one, so
   * giving up on the 429 threw away every finished chunk and the next attempt
   * hit the identical wall at the identical place. Pressing the button again
   * could never help — only waiting could, and nothing waited.
   */
  function rateLimited(retryAfter?: string): Response {
    return new Response('{}', {
      status: 429,
      ...(retryAfter === undefined ? {} : { headers: { 'retry-after': retryAfter } }),
    });
  }

  it('waits the interval Groq asks for, then tries again', async () => {
    const send = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(rateLimited('30'))
      .mockResolvedValueOnce(response(200));

    const result = await settle(withRetry(send, undefined, { rateLimitBudgetMs: 60_000 }));

    expect(result.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('does not spend a transient-failure attempt on a rate limit', async () => {
    // Three 429s is one server saying "not yet" three times. Counting them
    // against the ceiling meant for 502s is what capped the waiting at two
    // rounds and failed jobs that were one refill away from finishing.
    const send = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(rateLimited('10'))
      .mockResolvedValueOnce(rateLimited('10'))
      .mockResolvedValueOnce(rateLimited('10'))
      .mockResolvedValueOnce(response(200));

    const result = await settle(withRetry(send, undefined, { rateLimitBudgetMs: 600_000 }));

    expect(result.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(4);
  });

  it('reports the rate limit once the budget cannot cover the next wait', async () => {
    // Waiting has to end somewhere. Handing back the 429 is what gets the
    // reader a message and their button, instead of an unbounded spinner.
    const send = vi.fn<() => Promise<Response>>().mockResolvedValue(rateLimited('40'));

    const result = await settle(withRetry(send, undefined, { rateLimitBudgetMs: 60_000 }));

    expect(result.status).toBe(429);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('surfaces a wait too long to be worth holding the job for', async () => {
    const send = vi.fn<() => Promise<Response>>().mockResolvedValue(rateLimited('3600'));

    const result = await settle(withRetry(send, undefined, { rateLimitBudgetMs: 600_000 }));

    expect(result.status).toBe(429);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('waits a default interval when Groq does not say how long', async () => {
    // Falling back to giving up would reintroduce the whole bug through a side
    // door, for the sake of one absent header.
    const send = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(rateLimited())
      .mockResolvedValueOnce(response(200));

    const result = await settle(withRetry(send, undefined, { rateLimitBudgetMs: 60_000 }));

    expect(result.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('reports where a wait is up to, often enough to prove the job is alive', async () => {
    /*
      Load-bearing twice over: the queue reclaims a job that goes quiet for
      three minutes, so a silent 150-second wait would have another worker
      restart the episode from a fresh download — and the reader watching a
      still bar needs to be told the difference between parked and hung.
    */
    const send = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(rateLimited('60'))
      .mockResolvedValueOnce(response(200));

    const notices: number[] = [];

    await settle(
      withRetry(send, undefined, {
        rateLimitBudgetMs: 600_000,
        onWait: ({ remainingMs }) => void notices.push(remainingMs),
      }),
    );

    // A 60s wait, reported every 15s, counting down rather than repeating.
    expect(notices).toEqual([60_000, 45_000, 30_000, 15_000]);
  });

  it('does not retry audio that was too large', async () => {
    const send = vi.fn<() => Promise<Response>>().mockResolvedValue(response(413));

    await settle(withRetry(send));

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries a dropped socket, which a 20MB upload does often enough', async () => {
    const send = vi
      .fn<() => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(response(200));

    const result = await settle(withRetry(send));

    expect(result.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('rethrows a network failure that never recovers', async () => {
    const send = vi.fn<() => Promise<Response>>().mockRejectedValue(new TypeError('fetch failed'));

    await expect(settle(withRetry(send))).rejects.toThrow('fetch failed');
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('stops immediately when the caller has aborted', async () => {
    // An abort is the caller going away, not the provider failing. Retrying it
    // would be doing work for a request nobody is waiting on.
    const controller = new AbortController();
    controller.abort();

    const error = new Error('aborted');
    error.name = 'AbortError';
    const send = vi.fn<() => Promise<Response>>().mockRejectedValue(error);

    await expect(settle(withRetry(send, controller.signal))).rejects.toThrow('aborted');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('calls `send` afresh each time, so a consumed body is never resent', async () => {
    // The transcription body is a stream inside a FormData and can only be read
    // once. Retrying by reusing the same request would upload nothing at all —
    // a failure that looks nothing like the 502 that triggered it.
    const bodies: string[] = [];
    let attempt = 0;
    const send = vi.fn<() => Promise<Response>>().mockImplementation(() => {
      attempt += 1;
      bodies.push(`body-${attempt}`);
      return Promise.resolve(response(attempt === 1 ? 502 : 200));
    });

    await settle(withRetry(send));

    expect(bodies).toEqual(['body-1', 'body-2']);
  });
});

/**
 * Dealing the flat word list out to the cues it belongs to.
 *
 * Whisper returns words for the whole upload in one array, not nested inside
 * the segments, and the two views are derived separately. Partitioning them by
 * timestamp is the obvious approach and it is wrong — see `partitionWords`.
 * These pin the text-based behaviour that replaced it.
 */
describe('partitionWords', () => {
  const w = (text: string, startMs: number, endMs: number) => ({ startMs, endMs, text });

  it('reconstructs each segment exactly', () => {
    const words = [w('one', 0, 400), w('two', 400, 900), w('three', 900, 1500)];
    const out = partitionWords([{ text: 'one two' }, { text: 'three' }], words);

    expect(out[0]?.map((x) => x.text)).toEqual(['one', 'two']);
    expect(out[1]?.map((x) => x.text)).toEqual(['three']);
  });

  /**
   * The regression this replaced. A word straddling a cue boundary used to be
   * assigned by its midpoint, which put it on whichever side the arithmetic
   * favoured rather than the side its sentence is on. Measured against a real
   * Groq response, that misplaced a word in 9 of 37 segments.
   */
  it('keeps a straddling word with the sentence it belongs to', () => {
    // "off" is timed inside the first cue but the text puts it in the second.
    const words = [w('get', 0, 300), w('this', 300, 600), w('off', 600, 900), w('the', 900, 1200)];
    const out = partitionWords([{ text: 'get this' }, { text: 'off the' }], words);

    expect(out[0]?.map((x) => x.text)).toEqual(['get', 'this']);
    expect(out[1]?.map((x) => x.text)).toEqual(['off', 'the']);
  });

  it('gives every word to exactly one segment', () => {
    const words = [w('a', 0, 100), w('b', 100, 200), w('c', 200, 300)];
    const out = partitionWords([{ text: 'a' }, { text: 'b c' }], words);
    expect(out.flatMap((x) => x ?? []).map((x) => x.text)).toEqual(['a', 'b', 'c']);
  });

  it('ignores whitespace differences between the two views', () => {
    const words = [w('Hello,', 0, 300), w('world!', 300, 600)];
    expect(partitionWords([{ text: '  Hello,   world!  ' }], words)?.[0]).toHaveLength(2);
  });

  it('reports null for a segment its words cannot spell', () => {
    // Better to estimate one line than to render text the transcript does not
    // contain. Whisper's word and segment views really do disagree sometimes.
    const words = [w('completely', 0, 500), w('different', 500, 900)];
    expect(partitionWords([{ text: 'not these words at all' }], words)[0]).toBeNull();
  });

  it('does not let one unmatched segment derail the rest', () => {
    const words = [w('aa', 0, 100), w('bb', 100, 200), w('cc', 200, 300)];
    // The first segment cannot be spelled; the second still resolves.
    const out = partitionWords([{ text: 'zz' }, { text: 'bb cc' }], words);
    expect(out[0]).toBeNull();
    expect(out[1]?.map((x) => x.text)).toEqual(['bb', 'cc']);
  });

  /**
   * The failure that used to cost twenty minutes of transcript.
   *
   * Whisper's word view can split a token its segment view keeps whole — a
   * hyphenated word is the usual culprit. The segment holding it cannot be
   * spelled, and before the resync the stranded cursor made every *later*
   * segment fail too, silently reverting the whole chunk to estimates.
   */
  it('recovers the segments after one it could not spell', () => {
    const words = [
      w('this', 0, 200), w('is', 200, 400), w('fine', 400, 600),
      // The segment text has "well-known"; the word stream splits it.
      w('a', 600, 700), w('well', 700, 900), w('known', 900, 1100), w('problem', 1100, 1400),
      w('and', 1400, 1600), w('then', 1600, 1800), w('some', 1800, 2000), w('more', 2000, 2200),
      w('the', 2200, 2400), w('last', 2400, 2600), w('line', 2600, 2800),
    ];
    const out = partitionWords(
      [
        { text: 'this is fine' },
        { text: 'a well - known problem' },
        { text: 'and then some more' },
        { text: 'the last line' },
      ],
      words,
    );

    expect(out[0]?.map((x) => x.text)).toEqual(['this', 'is', 'fine']);
    expect(out[1]).toBeNull();
    // The point: these two are unaffected by the one above them failing.
    expect(out[2]?.map((x) => x.text)).toEqual(['and', 'then', 'some', 'more']);
    expect(out[3]?.map((x) => x.text)).toEqual(['the', 'last', 'line']);
  });

  it('reports null when there are no words left to give', () => {
    expect(partitionWords([{ text: 'orphan' }], [])[0]).toBeNull();
  });

  it('reports null for an empty segment rather than consuming words', () => {
    const words = [w('kept', 0, 100)];
    const out = partitionWords([{ text: '' }, { text: 'kept' }], words);
    expect(out[0]).toBeNull();
    expect(out[1]?.map((x) => x.text)).toEqual(['kept']);
  });
});

/**
 * The shape Groq actually returns, and what we make of it.
 *
 * `verbose_json` puts words in one flat array for the whole upload, alongside
 * — not inside — the segments. Everything here is about that seam.
 */
describe('transcribe response handling', () => {
  const ok = (body: unknown) =>
    vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

  const call = () =>
    transcribe({ key: 'k', byok: false, bytes: new Uint8Array([1, 2, 3]), filename: 'a.mp3' });

  afterEach(() => vi.unstubAllGlobals());

  it('asks for word timestamps as well as segments', async () => {
    const send = ok({ segments: [{ start: 0, end: 1, text: 'hi' }] });
    vi.stubGlobal('fetch', send);
    await call();

    const form = send.mock.calls[0]![1]!.body as FormData;
    expect(form.getAll('timestamp_granularities[]')).toEqual(['segment', 'word']);
    expect(form.get('response_format')).toBe('verbose_json');
  });

  it('attaches each word to the segment it falls inside', async () => {
    vi.stubGlobal(
      'fetch',
      ok({
        segments: [
          { start: 0, end: 2, text: 'one two' },
          { start: 2, end: 4, text: 'three' },
        ],
        words: [
          { start: 0, end: 0.8, word: 'one' },
          { start: 0.8, end: 2, word: 'two' },
          { start: 2, end: 3.5, word: 'three' },
        ],
      }),
    );

    const [first, second] = await call();
    expect(first!.words?.map((w) => w.text)).toEqual(['one', 'two']);
    expect(second!.words?.map((w) => w.text)).toEqual(['three']);
    expect(first!.words?.[0]).toEqual({ startMs: 0, endMs: 800, text: 'one' });
  });

  it('reports null words when the model returned none', async () => {
    // Null is the signal to estimate. An empty array would mean "no words here"
    // and the line would never sweep.
    vi.stubGlobal('fetch', ok({ segments: [{ start: 0, end: 1, text: 'hi' }] }));
    expect((await call())[0]!.words).toBeNull();
  });

  it('still handles a response carrying only flat text', async () => {
    vi.stubGlobal('fetch', ok({ text: 'just words, no timings' }));
    expect(await call()).toEqual([
      { startMs: 0, endMs: 0, text: 'just words, no timings', words: null },
    ]);
  });
});
