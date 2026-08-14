/**
 * Reading a server-sent event stream on two runtimes that cannot do it the
 * same way.
 *
 * On the web, `fetch` gives back a `ReadableStream` and this is four lines.
 * **React Native's `fetch` has no `response.body` at all** — it is implemented
 * over `XMLHttpRequest`, which delivers the body as a growing string rather
 * than as chunks. There is no polyfill that changes this; the transport is
 * genuinely different.
 *
 * So the transport is a parameter. Both implementations produce the same thing
 * — whole SSE frames, in order — and everything above them is shared. The
 * alternative was a streaming answer on web and a several-second blank pause on
 * the phone, which is the platform where waiting is least tolerable.
 */

export type SseRequest = {
  url: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
  /** Called once per complete frame, without the blank-line separator. */
  onFrame: (frame: string) => void;
  /**
   * Called instead of `onFrame` when the server answered with an error status.
   * The stream never opened, so this is an ordinary JSON envelope.
   */
  onFailure: (status: number, body: string) => never;
};

export type SseTransport = (request: SseRequest) => Promise<void>;

/**
 * Split a growing buffer into whole frames.
 *
 * Returns what is left over. A network chunk can end anywhere — mid-frame,
 * mid-word, between the `event:` and `data:` lines — so a partial frame is
 * never handed on; it waits for the rest.
 */
export function drainFrames(buffer: string, onFrame: (frame: string) => void): string {
  let rest = buffer;
  let split = rest.indexOf('\n\n');

  while (split !== -1) {
    onFrame(rest.slice(0, split));
    rest = rest.slice(split + 2);
    split = rest.indexOf('\n\n');
  }

  return rest;
}

/**
 * The web transport: `fetch` plus a byte stream.
 *
 * `response.body` is reached through a cast because React Native's `Response`
 * type does not declare it, and this file is compiled for both. The runtime
 * check below is the real gate.
 */
export const fetchSse: SseTransport = async (request) => {
  const response = await fetch(request.url, {
    method: 'POST',
    headers: request.headers,
    credentials: 'include',
    body: request.body,
    ...(request.signal ? { signal: request.signal } : {}),
  });

  if (!response.ok) {
    request.onFailure(response.status, await response.text().catch(() => ''));
  }

  const body = (response as { body?: unknown }).body as ReadableByteStream | undefined | null;

  if (!body) {
    // A runtime whose fetch does not stream. Falling back to the whole text is
    // still a correct answer, just not an incremental one.
    const whole = await response.text();
    drainFrames(whole.endsWith('\n\n') ? whole : `${whole}\n\n`, request.onFrame);
    return;
  }

  const decode = makeDecoder();
  const reader = body.getReader();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) buffer = drainFrames(buffer + decode(value), request.onFrame);
    }
  } finally {
    reader.releaseLock();
  }
};

/**
 * The React Native transport: `XMLHttpRequest`, read as it grows.
 *
 * `responseText` accumulates the whole body, so each progress event is handled
 * by taking only the part that arrived since the last one. Reprocessing the
 * whole string every time would replay every token from the beginning and
 * render the answer several times over.
 */
export const xhrSse: SseTransport = (request) =>
  new Promise<void>((resolve, reject) => {
    const XHR = (globalThis as { XMLHttpRequest?: new () => XmlHttpRequestLike }).XMLHttpRequest;

    if (!XHR) {
      reject(new Error('No XMLHttpRequest available for streaming'));
      return;
    }

    const xhr = new XHR();
    xhr.open('POST', request.url, true);
    xhr.withCredentials = true;

    for (const [name, value] of Object.entries(request.headers)) {
      xhr.setRequestHeader(name, value);
    }

    let consumed = 0;
    let buffer = '';
    let failed = false;

    const pump = () => {
      // Only 2xx bodies are frames. An error body is JSON and is handled whole
      // at the end, where the status is final.
      if (failed || xhr.status < 200 || xhr.status >= 300) return;

      const text = xhr.responseText;
      if (text.length <= consumed) return;

      buffer = drainFrames(buffer + text.slice(consumed), request.onFrame);
      consumed = text.length;
    };

    xhr.onreadystatechange = () => {
      // 3 = LOADING: the body is arriving. This is the event that makes the
      // answer appear a word at a time rather than all at once.
      if (xhr.readyState === 3) pump();

      if (xhr.readyState !== 4) return;

      if (xhr.status < 200 || xhr.status >= 300) {
        failed = true;
        try {
          request.onFailure(xhr.status, xhr.responseText);
        } catch (error) {
          reject(error);
        }
        return;
      }

      try {
        pump();
        resolve();
      } catch (error) {
        reject(error);
      }
    };

    xhr.onerror = () => reject(new Error('The connection failed'));
    xhr.onabort = () => reject(abortError());

    request.signal?.addEventListener('abort', () => xhr.abort());

    xhr.send(request.body);
  });

/** Matches what `fetch` throws, so callers need one abort check rather than two. */
function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

/**
 * A streaming UTF-8 decoder, or a best-effort substitute.
 *
 * `TextDecoder` is present on both runtimes today, but it is reached through
 * `globalThis` rather than as a bare identifier so this file does not require
 * DOM lib types to compile for React Native.
 */
function makeDecoder(): (bytes: Uint8Array) => string {
  const Ctor = (globalThis as { TextDecoder?: new (label?: string) => TextDecoderLike }).TextDecoder;

  if (!Ctor) {
    // Multi-byte characters split across a chunk boundary will be mangled here.
    // Accepted rather than shimmed: every runtime this ships to has the real
    // thing, and this exists so a missing global degrades instead of throwing.
    return (bytes) => String.fromCharCode(...bytes);
  }

  const decoder = new Ctor('utf-8');
  return (bytes) => decoder.decode(bytes, { stream: true });
}

type TextDecoderLike = {
  decode(input?: Uint8Array, options?: { stream?: boolean }): string;
};

type ReadableByteStream = {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    releaseLock(): void;
  };
};

type XmlHttpRequestLike = {
  open(method: string, url: string, async: boolean): void;
  setRequestHeader(name: string, value: string): void;
  send(body: string): void;
  abort(): void;
  withCredentials: boolean;
  readyState: number;
  status: number;
  responseText: string;
  onreadystatechange: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
};
