ALTER TABLE "player_connection" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
CREATE INDEX "player_connection_owner_idx" ON "player_connection" USING btree ("owner_id");