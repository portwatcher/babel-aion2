import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema/index.ts'

export function databasePoolSize(value: unknown, minimum = 1) {
  const size =
    value === undefined
      ? 10
      : typeof value === 'number'
        ? value
        : typeof value === 'string' && /^\d+$/.test(value)
          ? Number(value)
          : NaN
  if (!Number.isSafeInteger(size) || size < minimum) {
    throw new Error('Database pool size is invalid')
  }
  return size
}

export function createDatabase(
  connectionString: string,
  options: { queryTimeoutMs?: number; maxConnections?: number } = {},
) {
  const pool = new Pool({
    connectionString,
    max: databasePoolSize(options.maxConnections),
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    query_timeout: options.queryTimeoutMs,
    statement_timeout: options.queryTimeoutMs,
  })
  const db = drizzle(pool, { schema })
  return { db, pool, close: () => pool.end() }
}

export type Database = ReturnType<typeof createDatabase>['db']
