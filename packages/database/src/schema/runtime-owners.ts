import { sql } from 'drizzle-orm'
import { pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { runtimePod } from './runtime-pods.ts'

// An incarnation ID is never reused. Age and lost heartbeats are not exit proof.
export const runtimeOwner = pgTable(
  'runtime_owner',
  {
    id: uuid('id').primaryKey(),
    podUid: uuid('pod_uid').references(() => runtimePod.uid),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    exitedAt: timestamp('exited_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('runtime_owner_active_pod_idx')
      .on(table.podUid)
      .where(sql`${table.exitedAt} is null and ${table.podUid} is not null`),
  ],
)
