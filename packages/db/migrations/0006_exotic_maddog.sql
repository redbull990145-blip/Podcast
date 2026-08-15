CREATE TABLE "playlist_items" (
	"playlist_id" uuid NOT NULL,
	"episode_id" uuid NOT NULL,
	"sort_key" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_items" ADD CONSTRAINT "playlist_items_episode_id_episodes_id_fk" FOREIGN KEY ("episode_id") REFERENCES "public"."episodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlists" ADD CONSTRAINT "playlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "playlist_items_playlist_episode_key" ON "playlist_items" USING btree ("playlist_id","episode_id");--> statement-breakpoint
CREATE INDEX "playlist_items_order_idx" ON "playlist_items" USING btree ("playlist_id","sort_key");--> statement-breakpoint
CREATE INDEX "playlist_items_episode_idx" ON "playlist_items" USING btree ("episode_id");--> statement-breakpoint
CREATE INDEX "playlists_user_idx" ON "playlists" USING btree ("user_id","updated_at" DESC NULLS LAST);