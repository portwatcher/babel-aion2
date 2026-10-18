ALTER TABLE "listener_session" ADD COLUMN "request_fingerprint" text;--> statement-breakpoint
-- Preserve any scaffold-era records without permitting an unbound entry replay.
UPDATE "listener_session" SET "request_fingerprint" = 'legacy:' || "request_id"::text;--> statement-breakpoint
ALTER TABLE "listener_session" ALTER COLUMN "request_fingerprint" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "listener_session" ADD COLUMN "subscription_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "listener_session" ADD COLUMN "delivery_stopped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listener_session" ADD COLUMN "terminal_reason" text;
