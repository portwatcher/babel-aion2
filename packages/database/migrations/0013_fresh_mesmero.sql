CREATE TABLE "community_room" (
	"room_id" uuid PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"creator_id" text NOT NULL,
	"server" text NOT NULL,
	"allowed_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "community_room_guild_id_unique" UNIQUE("guild_id")
);
--> statement-breakpoint
CREATE TABLE "listener_character" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"profile" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "map_stroke" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"nickname" text NOT NULL,
	"color" text NOT NULL,
	"points" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_installation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"state_hash" text NOT NULL,
	"browser_hash" text NOT NULL,
	"name" text NOT NULL,
	"server" text NOT NULL,
	"allowed_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"guild_id" text,
	"creator_id" text,
	"consumed_room_id" uuid,
	"authorized_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "room_installation_state_hash_unique" UNIQUE("state_hash")
);
--> statement-breakpoint
ALTER TABLE "community_room" ADD CONSTRAINT "community_room_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listener_character" ADD CONSTRAINT "listener_character_session_id_listener_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."listener_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_stroke" ADD CONSTRAINT "map_stroke_room_id_room_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."room"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_stroke" ADD CONSTRAINT "map_stroke_session_id_listener_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."listener_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_installation" ADD CONSTRAINT "room_installation_consumed_room_id_room_id_fk" FOREIGN KEY ("consumed_room_id") REFERENCES "public"."room"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "map_stroke_room_idx" ON "map_stroke" USING btree ("room_id","created_at");--> statement-breakpoint
UPDATE "room" SET "name" = 'AION2 深渊战' WHERE "id" = '00000000-0000-4000-8000-000000000001' AND "name" = 'AION2 深渊站';
