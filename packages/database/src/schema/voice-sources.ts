import { sql } from 'drizzle-orm'
import {
  bigint,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { room } from './rooms.ts'

// An unknown owner is never considered stopped merely because its lock expired.
// Closed receipts are written only after Discord and old room media have closed.
export const voiceSourceRun = pgTable(
  'voice_source_run',
  {
    id: uuid('id').primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => room.id),
    sourceGeneration: bigint('source_generation', { mode: 'number' }).notNull(),
    controlKey: text('control_key').notNull(),
    ownerId: uuid('owner_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('voice_source_control_live_idx')
      .on(table.controlKey)
      .where(sql`${table.closedAt} is null`),
    uniqueIndex('voice_source_room_live_idx')
      .on(table.roomId)
      .where(sql`${table.closedAt} is null`),
  ],
)
