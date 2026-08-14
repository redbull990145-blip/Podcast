CREATE TABLE "transcripts" (
	"episode_id" uuid PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'feed' NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"detail" text,
	"segments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transcripts_status_idx" ON "transcripts" USING btree ("status","fetched_at");