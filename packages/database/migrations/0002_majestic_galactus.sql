CREATE TABLE "player_connection" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"nickname_generation" bigint NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "player_connection" ADD CONSTRAINT "player_connection_session_id_listener_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."listener_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_connection_session_idx" ON "player_connection" USING btree ("session_id","nickname_generation");