CREATE TABLE "language_catalog" (
	"id" text PRIMARY KEY NOT NULL,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "output_language" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "output_language" ADD COLUMN "path_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "output_language" ADD COLUMN "include_terms" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "output_language" ADD COLUMN "validation" jsonb;--> statement-breakpoint
ALTER TABLE "output_language" ADD COLUMN "last_attempt" jsonb;
--> statement-breakpoint
INSERT INTO "language_catalog" ("id", "version") SELECT 'global', COALESCE(MAX("version"), 0) FROM "output_language";
--> statement-breakpoint
WITH ordered AS (SELECT "code", row_number() OVER (ORDER BY "sort_order", "code") - 1 AS position FROM "output_language") UPDATE "output_language" SET "sort_order" = ordered.position FROM ordered WHERE "output_language"."code" = ordered."code";
