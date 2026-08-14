CREATE TABLE "playback_progress" (
	"user_id" text NOT NULL,
	"episode_id" uuid NOT NULL,
	"position_sec" integer DEFAULT 0 NOT NULL,
	"duration_sec" integer,
	"completed" boolean DEFAULT false NOT NULL,
	"device_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "queue_items" (
	"user_id" text NOT NULL,
	"episode_id" uuid NOT NULL,
	"sort_key" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playback_progress" ADD CONSTRAINT "playback_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playback_progress" ADD CONSTRAINT "playback_progress_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "queue_items" ADD CONSTRAINT "queue_items_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "playback_progress_user_episode_key" ON "playback_progress" USING btree ("user_id","episode_id");--> statement-breakpoint
CREATE INDEX "playback_progress_continue_idx" ON "playback_progress" USING btree ("user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "queue_items_user_episode_key" ON "queue_items" USING btree ("user_id","episode_id");--> statement-breakpoint
CREATE INDEX "queue_items_order_idx" ON "queue_items" USING btree ("user_id","sort_key");