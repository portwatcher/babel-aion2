CREATE TABLE "provider_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"configuration_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"settings" jsonb NOT NULL,
	"encrypted_credential" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_configuration" ADD COLUMN "last_test" jsonb;--> statement-breakpoint
ALTER TABLE "provider_configuration" ADD COLUMN "test_lease_id" uuid;--> statement-breakpoint
ALTER TABLE "provider_configuration" ADD COLUMN "test_lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_configuration" ADD COLUMN "last_test_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_revision" ADD CONSTRAINT "provider_revision_configuration_id_provider_configuration_id_fk" FOREIGN KEY ("configuration_id") REFERENCES "public"."provider_configuration"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_revision_version_idx" ON "provider_revision" USING btree ("configuration_id","version");