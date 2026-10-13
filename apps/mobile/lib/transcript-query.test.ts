import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ transcript: vi.fn() }));
vi.mock('./api', () => ({ api: { getTranscript: mocks.transcript } }));
import { transcriptQueryOptions } from './transcript-query';
describe('mobile generated transcripts', () => {
  it('fetches generated-only episodes without a publisher URL and passes cancellation', async () => {
    mocks.transcript.mockResolvedValue({ transcript: { status: 'ready', source: 'generated' }, detail: null });
    const options = transcriptQueryOptions('generated-only', true); const signal = new AbortController().signal;
    expect(options.enabled).toBe(true); expect(await options.queryFn({ signal })).toMatchObject({ transcript: { status: 'ready' } });
    expect(mocks.transcript).toHaveBeenCalledWith('generated-only', { signal });
  });
  it('polls processing and keeps unavailable and failed results refreshable', () => {
    const options = transcriptQueryOptions('e', true);
    for (const status of [null, 'failed', 'processing', 'ready']) {
      const query = { state: { data: { transcript: status ? { status } : null, detail: null } } } as Parameters<typeof options.staleTime>[0];
      expect(options.staleTime(query)).toBe(status === 'ready' ? Infinity : 0);
      expect(options.refetchInterval(query)).toBe(status === 'processing' ? 4000 : false);
    }
  });
});
