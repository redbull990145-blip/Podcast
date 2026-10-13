import { queryKeys } from '@cue/api-client';
import type { Transcript } from '@cue/types';
import { api } from './api';

type State = { state: { data?: { transcript: Transcript | null; detail: string | null } } };
export function transcriptQueryOptions(id: string, enabled: boolean) {
  return {
    queryKey: queryKeys.episode.transcript(id),
    queryFn: ({ signal }: { signal: AbortSignal }) => api.getTranscript(id, { signal }),
    enabled,
    // An absent, failed or processing result may change after another client
    // admits work. Only a published transcript remains indefinitely fresh.
    staleTime: (query: State) => query.state.data?.transcript?.status === 'ready' ? Infinity : 0,
    refetchInterval: (query: State) => query.state.data?.transcript?.status === 'processing' ? 4000 : false,
  };
}
