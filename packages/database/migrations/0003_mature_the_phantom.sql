ALTER TABLE "room" ADD COLUMN "configuration_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "room" ADD COLUMN "discord_guild_id" text;--> statement-breakpoint
ALTER TABLE "room" ADD COLUMN "discord_voice_channel_id" text;--> statement-breakpoint
ALTER TABLE "room" ADD COLUMN "commander_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "room" ADD COLUMN "encrypted_discord_credential" text;--> statement-breakpoint
ALTER TABLE "room" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;