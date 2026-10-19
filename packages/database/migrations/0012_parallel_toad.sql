CREATE TABLE "runtime_pod" (
	"uid" uuid PRIMARY KEY NOT NULL,
	"namespace" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retirement_requested_at" timestamp with time zone,
	"retired_at" timestamp with time zone,
	"exit_evidence" jsonb
);
--> statement-breakpoint
ALTER TABLE "runtime_owner" ADD COLUMN "pod_uid" uuid;--> statement-breakpoint
ALTER TABLE "runtime_owner" ADD CONSTRAINT "runtime_owner_pod_uid_runtime_pod_uid_fk" FOREIGN KEY ("pod_uid") REFERENCES "public"."runtime_pod"("uid") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_owner_active_pod_idx" ON "runtime_owner" USING btree ("pod_uid") WHERE "runtime_owner"."exited_at" is null and "runtime_owner"."pod_uid" is not null;