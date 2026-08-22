CREATE TABLE "playlist_banners" (
	"playlist_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" "bytea" NOT NULL,
	"version" uuid DEFAULT gen_random_uuid() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playlist_banners" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "playlist_podcasts" (
	"playlist_id" uuid NOT NULL,
	"podcast_id" uuid NOT NULL,
	"sort_key" text NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playlist_podcasts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "playlists" ADD COLUMN "kind" text DEFAULT 'episode' NOT NULL;--> statement-breakpoint
ALTER TABLE "playlists" ADD COLUMN "color" text DEFAULT 'ember' NOT NULL;--> statement-breakpoint
ALTER TABLE "playlists" ADD COLUMN "banner_kind" text DEFAULT 'color' NOT NULL;--> statement-breakpoint
ALTER TABLE "playlists" ADD COLUMN "banner_text" text;--> statement-breakpoint
ALTER TABLE "playlists" ADD COLUMN "background_color" text;--> statement-breakpoint
ALTER TABLE "playlist_banners" ADD CONSTRAINT "playlist_banners_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_podcasts" ADD CONSTRAINT "playlist_podcasts_playlist_id_playlists_id_fk" FOREIGN KEY ("playlist_id") REFERENCES "public"."playlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playlist_podcasts" ADD CONSTRAINT "playlist_podcasts_podcast_id_podcasts_id_fk" FOREIGN KEY ("podcast_id") REFERENCES "public"."podcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "playlist_podcasts_playlist_podcast_key" ON "playlist_podcasts" USING btree ("playlist_id","podcast_id");--> statement-breakpoint
CREATE INDEX "playlist_podcasts_order_idx" ON "playlist_podcasts" USING btree ("playlist_id","sort_key");--> statement-breakpoint
CREATE INDEX "playlist_podcasts_podcast_idx" ON "playlist_podcasts" USING btree ("podcast_id");