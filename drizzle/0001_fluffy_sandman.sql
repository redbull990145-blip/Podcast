ALTER TABLE "transcripts" ADD COLUMN "audio_duration_seconds" double precision;--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "audio_bytes" bigint;--> statement-breakpoint
ALTER TABLE "transcripts" ADD COLUMN "audio_etag" text;