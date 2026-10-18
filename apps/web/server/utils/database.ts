import { createDatabase } from '@babel/database'
import type { H3Event } from 'h3'

let connection: ReturnType<typeof createDatabase> | undefined

export function useDatabase(event: H3Event) {
  if (!connection) {
    const config = useRuntimeConfig(event)
    if (!config.databaseUrl) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Database is not configured',
      })
    }
    connection = createDatabase(config.databaseUrl)
  }
  return connection.db
}

export async function closeDatabase() {
  await connection?.close()
  connection = undefined
}
