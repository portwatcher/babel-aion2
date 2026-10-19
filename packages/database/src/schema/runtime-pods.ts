import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

export type RuntimePodExitEvidence =
  | { kind: 'owners-exited' }
  | {
      kind: 'kubelet-terminated'
      resourceVersion: string
      containers: {
        name: string
        containerId: string
        exitCode: number
        reason: string
        finishedAt: string
      }[]
    }

// A durable admission barrier also retains termination evidence after Pod GC.
export const runtimePod = pgTable('runtime_pod', {
  uid: uuid('uid').primaryKey(),
  namespace: text('namespace').notNull(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  retirementRequestedAt: timestamp('retirement_requested_at', { withTimezone: true }),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  exitEvidence: jsonb('exit_evidence').$type<RuntimePodExitEvidence>(),
})
