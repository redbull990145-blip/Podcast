BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.transcription_jobs
  ADD COLUMN lease_token uuid,
  ADD COLUMN funding_source text NOT NULL DEFAULT 'legacy',
  ADD COLUMN quota_state text NOT NULL DEFAULT 'legacy',
  ADD CONSTRAINT transcription_jobs_funding_source_check
    CHECK (funding_source IN ('legacy', 'byok', 'operator')),
  ADD CONSTRAINT transcription_jobs_quota_state_check
    CHECK (quota_state IN ('legacy', 'unmetered', 'reserved', 'refunded')),
  ADD CONSTRAINT transcription_jobs_funding_quota_check
    CHECK (
      (funding_source = 'legacy' AND quota_state = 'legacy')
      OR (funding_source = 'byok' AND quota_state = 'unmetered'
          AND quota_day IS NULL)
      OR (funding_source = 'operator' AND quota_state IN ('reserved', 'refunded')
          AND quota_day IS NOT NULL)
    ),
  ADD CONSTRAINT transcription_jobs_running_lease_check
    CHECK (funding_source = 'legacy' OR status <> 'running'
           OR lease_token IS NOT NULL);

COMMIT;
