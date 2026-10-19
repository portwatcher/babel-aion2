CREATE TYPE "public"."room_audio_source" AS ENUM('DISCORD', 'PLAYER');--> statement-breakpoint
ALTER TABLE "community_room" ALTER COLUMN "guild_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "community_room" ALTER COLUMN "creator_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "room" ADD COLUMN "audio_source" "room_audio_source" DEFAULT 'DISCORD' NOT NULL;--> statement-breakpoint
ALTER TABLE "room" ADD COLUMN "host_character_id" text;