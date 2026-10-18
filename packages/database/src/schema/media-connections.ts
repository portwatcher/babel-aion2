import { bigint, index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import { listenerSession } from './rooms.ts'

export const mediaConnection = pgTable(
  'media_connection',
  {
    id: uuid('id').primaryKey(),
    ownerId: uuid('owner_id').notNull(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => listenerSession.id, { onDelete: 'cascade' }),
    nicknameGeneration: bigint('nickname_generation', { mode: 'number' }).notNull(),
    attempt: bigint('attempt', { mode: 'number' }).notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closeRequestedAt: timestamp('close_requested_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    index('media_connection_session_idx').on(table.sessionId, table.nicknameGeneration),
    index('media_connection_owner_idx').on(table.ownerId),
  ],
)
