import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema/index.ts'

export function createDatabase(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  })
  const db = drizzle(pool, { schema })
  return { db, pool, close: () => pool.end() }
}

export type Database = ReturnType<typeof createDatabase>['db']
