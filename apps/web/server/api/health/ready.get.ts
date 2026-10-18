import { sql } from 'drizzle-orm'
import { useDatabase } from '../../utils/database'

export default defineEventHandler(async (event) => {
  try {
    await useDatabase(event).execute(sql`select 1 from auth_user limit 1`)
    await useDatabase(event).execute(
      sql`select request_fingerprint, subscription_version, delivery_stopped_at, terminal_reason from listener_session limit 1`,
    )
    await useDatabase(event).execute(sql`select id from player_connection limit 1`)
    await useDatabase(event).execute(
      sql`select configuration_version, encrypted_discord_credential from room limit 1`,
    )
    await useDatabase(event).execute(
      sql`select last_test, test_lease_id from provider_configuration limit 1`,
    )
    await useDatabase(event).execute(sql`select id from provider_revision limit 1`)
    await useDatabase(event).execute(
      sql`select source_term, alternatives, expressions, version from game_term limit 1`,
    )
    const catalog = await useDatabase(event).execute(
      sql`select version from term_catalog where id = 'global'`,
    )
    if (catalog.rows.length !== 1) {
      throw new Error('Term catalog is missing')
    }
    return { status: 'ok' }
  } catch {
    throw createError({
      statusCode: 503,
      statusMessage: 'Database is not ready or migrations are missing',
    })
  }
})
