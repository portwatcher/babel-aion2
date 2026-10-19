ALTER TABLE "room" ADD COLUMN "disbanded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_room" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;