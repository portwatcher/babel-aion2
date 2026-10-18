CREATE TABLE "runtime_owner" (
	"id" uuid PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"exited_at" timestamp with time zone
);
