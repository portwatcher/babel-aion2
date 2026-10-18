import { pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'

// An incarnation ID is never reused. Age and lost heartbeats are not exit proof.
export const runtimeOwner = pgTable('runtime_owner', {
  id: uuid('id').primaryKey(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  exitedAt: timestamp('exited_at', { withTimezone: true }),
})
