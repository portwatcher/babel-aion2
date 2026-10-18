CREATE TABLE "voice_source_run" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"source_generation" bigint NOT NULL,
	"control_key" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "voice_source_run" ADD CONSTRAINT "voice_source_run_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "voice_source_control_live_idx" ON "voice_source_run" USING btree ("control_key") WHERE "voice_source_run"."closed_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "voice_source_room_live_idx" ON "voice_source_run" USING btree ("room_id") WHERE "voice_source_run"."closed_at" is null;