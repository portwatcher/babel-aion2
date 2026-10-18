CREATE TABLE "media_connection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"nickname_generation" bigint NOT NULL,
	"attempt" bigint NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"close_requested_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "media_connection" ADD CONSTRAINT "media_connection_session_id_listener_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."listener_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_connection_session_idx" ON "media_connection" USING btree ("session_id","nickname_generation");--> statement-breakpoint
CREATE INDEX "media_connection_owner_idx" ON "media_connection" USING btree ("owner_id");