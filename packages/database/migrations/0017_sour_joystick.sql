ALTER TABLE "community_room" ADD COLUMN "number" integer;
--> statement-breakpoint
WITH numbered AS (
  SELECT community_room.room_id,
    row_number() OVER (ORDER BY room.created_at, room.id)::integer AS number
  FROM community_room
  JOIN room ON room.id = community_room.room_id
)
UPDATE community_room SET number = numbered.number
FROM numbered WHERE community_room.room_id = numbered.room_id;
--> statement-breakpoint
ALTER TABLE "community_room" ALTER COLUMN "number" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "community_room" ALTER COLUMN "number" ADD GENERATED ALWAYS AS IDENTITY (sequence name "community_room_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1);
--> statement-breakpoint
SELECT setval('community_room_number_seq', COALESCE((SELECT MAX(number) FROM community_room), 0) + 1, false);
--> statement-breakpoint
ALTER TABLE "community_room" ADD CONSTRAINT "community_room_number_unique" UNIQUE("number");
