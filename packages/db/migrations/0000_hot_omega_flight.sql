CREATE TABLE "categories" (
	"id" smallint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 32767 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"podcast_id" uuid NOT NULL,
	"guid" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"description_html" text,
	"audio_url" text NOT NULL,
	"audio_type" text,
	"audio_length_bytes" integer,
	"duration_sec" integer,
	"published_at" timestamp with time zone NOT NULL,
	"artwork_url" text,
	"episode_number" integer,
	"season_number" integer,
	"explicit" boolean DEFAULT false NOT NULL,
	"transcript_url" text,
	"transcript_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "podcast_categories" (
	"podcast_id" uuid NOT NULL,
	"category_id" smallint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "podcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_url" text NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"description" text,
	"artwork_url" text,
	"website_url" text,
	"language" text,
	"explicit" boolean DEFAULT false NOT NULL,
	"podcastindex_id" integer,
	"etag" text,
	"last_modified" text,
	"last_fetched_at" timestamp with time zone,
	"last_published_at" timestamp with time zone,
	"episode_count" integer,
	"fetch_failure_count" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_podcast_id_podcasts_id_fk" FOREIGN KEY ("podcast_id") REFERENCES "public"."podcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_categories" ADD CONSTRAINT "podcast_categories_podcast_id_podcasts_id_fk" FOREIGN KEY ("podcast_id") REFERENCES "public"."podcasts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "podcast_categories" ADD CONSTRAINT "podcast_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_key" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_podcast_guid_key" ON "episodes" USING btree ("podcast_id","guid");--> statement-breakpoint
CREATE INDEX "episodes_podcast_published_idx" ON "episodes" USING btree ("podcast_id","published_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "episodes_published_idx" ON "episodes" USING btree ("published_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "podcast_categories_pkey" ON "podcast_categories" USING btree ("podcast_id","category_id");--> statement-breakpoint
CREATE INDEX "podcast_categories_category_idx" ON "podcast_categories" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "podcasts_feed_url_key" ON "podcasts" USING btree ("feed_url");--> statement-breakpoint
CREATE UNIQUE INDEX "podcasts_podcastindex_id_key" ON "podcasts" USING btree ("podcastindex_id");--> statement-breakpoint
CREATE INDEX "podcasts_language_idx" ON "podcasts" USING btree ("language");--> statement-breakpoint
CREATE INDEX "podcasts_refresh_idx" ON "podcasts" USING btree ("last_fetched_at");