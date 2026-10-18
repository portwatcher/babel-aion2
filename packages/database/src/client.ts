import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema/index.ts'

export function createDatabase(
  connectionString: string,
  options: { queryTimeoutMs?: number } = {},
) {
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    query_timeout: options.queryTimeoutMs,
    statement_timeout: options.queryTimeoutMs,
  })
  const db = drizzle(pool, { schema })
  return { db, pool, close: () => pool.end() }
}

export type Database = ReturnType<typeof createDatabase>['db']
