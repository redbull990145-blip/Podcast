BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE public.transcription_jobs
  DROP CONSTRAINT transcription_jobs_running_lease_check,
  DROP CONSTRAINT transcription_jobs_funding_quota_check,
  DROP CONSTRAINT transcription_jobs_quota_state_check,
  DROP CONSTRAINT transcription_jobs_funding_source_check,
  DROP COLUMN quota_state,
  DROP COLUMN funding_source,
  DROP COLUMN lease_token;

COMMIT;
