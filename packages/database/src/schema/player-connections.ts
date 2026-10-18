import { bigint, index, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import { listenerSession } from './rooms.ts'

export const playerConnection = pgTable(
  'player_connection',
  {
    id: uuid('id').primaryKey(),
    // Existing receipts have no provable owner; preserve them as unknown.
    ownerId: uuid('owner_id'),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => listenerSession.id, { onDelete: 'cascade' }),
    nicknameGeneration: bigint('nickname_generation', { mode: 'number' }).notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    index('player_connection_owner_idx').on(table.ownerId),
    index('player_connection_session_idx').on(
      table.sessionId,
      table.nicknameGeneration,
    ),
  ],
)
