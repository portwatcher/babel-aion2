CREATE TABLE "game_term" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_term" text NOT NULL,
	"source_language" text NOT NULL,
	"alternatives" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"category" text NOT NULL,
	"expressions" jsonb NOT NULL,
	"context" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "term_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "game_term_source_idx" ON "game_term" USING btree ("source_language","source_term");
--> statement-breakpoint
INSERT INTO "term_catalog" ("id", "version") VALUES ('global', 0);
