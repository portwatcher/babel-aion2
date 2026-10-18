import { sql } from 'drizzle-orm'
import { useDatabase } from '../../utils/database'

export default defineEventHandler(async (event) => {
  try {
    await useDatabase(event).execute(sql`select 1 from auth_user limit 1`)
    return { status: 'ok' }
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Database is not ready or migrations are missing',
    })
  }
})
