/** Cancellation also bounds test doubles or upstream operations that ignore signals. */
export function operationDeadline(parent: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  const timer = setTimeout(
    () =>
      controller.abort(
        Object.assign(new Error('Provider operation deadline exceeded'), { name: 'TimeoutError' }),
      ),
    timeoutMs,
  );
  timer.unref?.();
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', abort);
    },
  };
}

export async function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  parent: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  const deadline = operationDeadline(parent, timeoutMs);
  try {
    deadline.signal.throwIfAborted();
    return await abortable(work(deadline.signal), deadline.signal);
  } finally {
    deadline.dispose();
  }
}

export function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    if (signal.aborted) {
      abort();
      work.catch(() => undefined);
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort))
      .catch(() => undefined);
  });
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason ?? Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    };
    const timer = setTimeout(done, ms);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

/** A per-request deadline includes headers AND body consumption. */
export async function fetchWithDeadline(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const parent = init.signal;
  const abort = () => controller.abort(parent?.reason);
  const timer = setTimeout(
    () =>
      controller.abort(
        Object.assign(new Error('Provider request deadline exceeded'), {
          name: 'TimeoutError',
        }),
      ),
    timeoutMs,
  );
  timer.unref?.();
  if (parent?.aborted) abort();
  else parent?.addEventListener('abort', abort, { once: true });
  const dispose = () => {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abort);
  };
  try {
    controller.signal.throwIfAborted();
    const response = await abortable(
      fetch(url, { ...init, signal: controller.signal }),
      controller.signal,
    );
    if (!response.body) {
      dispose();
      return response;
    }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const chunk = await abortable(reader.read(), controller.signal);
          if (chunk.done) {
            stream.close();
            dispose();
          } else stream.enqueue(chunk.value);
        } catch (error) {
          stream.error(error);
          dispose();
          void reader.cancel(error).catch(() => undefined);
        }
      },
      async cancel(reason) {
        controller.abort(reason);
        dispose();
        await reader.cancel(reason);
      },
    });
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    dispose();
    throw error;
  }
}
