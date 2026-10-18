import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import pg from 'pg'
import { until } from './media-worker.mjs'

export async function isolatedDatabase() {
  const url = new URL(process.env.DATABASE_URL)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  const admin = new pg.Client({ connectionString: url.toString() })
  await admin.connect()
  const name = `babel_recovery_${randomUUID().replaceAll('-', '')}`
  await admin.query(`create database ${name}`)
  url.pathname = `/${name}`
  const pool = new pg.Pool({ connectionString: url.toString(), max: 5 })
  async function close() {
    await pool.end()
    await until(
      async () => {
        const { rows } = await admin.query(
          'select count(*)::int as count from pg_stat_activity where datname=$1',
          [name],
        )
        return rows[0].count === 0
      },
      'recovery fixture connections drained',
      5_000,
    )
    await admin.query(`drop database ${name}`)
    await admin.end()
  }
  try {
    await promisify(execFile)(
      process.execPath,
      ['packages/database/dist/migrate.mjs'],
      {
        env: { ...process.env, DATABASE_URL: url.toString() },
        maxBuffer: 1_000_000,
      },
    ).catch(() => {
      throw new Error('Disposable recovery database migration failed')
    })
    return { url: url.toString(), pool, close }
  } catch (error) {
    await close()
    throw error
  }
}
