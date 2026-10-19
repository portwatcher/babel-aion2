import { seedLegacyRoom } from './fixtures/legacy-room.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { isolatedDatabase } from './fixtures/isolated-database.mjs'
import { startMediaWorker, until } from './fixtures/media-worker.mjs'
import { startTestServer } from './test-server.mjs'

test('configured process pool budgets bound real PostgreSQL connections while concurrent requests queue and recover', async (t) => {
  const database = await isolatedDatabase()
  await seedLegacyRoom(database.url)
  const prefix = `pool-${randomUUID().slice(0, 8)}`
  function labeled(component) {
    const url = new URL(database.url)
    url.searchParams.set('application_name', `${prefix}-${component}`)
    return url.toString()
  }
  let web, worker, held
  const requests = []
  t.after(async () => {
    await held?.query('rollback')
    held?.release()
    await Promise.allSettled(requests)
    await Promise.allSettled([web?.close(), worker?.close()])
    await database.close()
  })
  web = await startTestServer(labeled('web'), {
    environment: { NUXT_DATABASE_POOL_MAX: '2' },
  })
  worker = await startMediaWorker(
    labeled('worker'),
    randomBytes(32).toString('base64url'),
    undefined,
    {
      DATABASE_POOL_MAX: '2',
      PROVIDER_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    },
  )
  held = await database.pool.connect()
  await held.query('begin')
  await held.query(
    'lock table room, media_connection, output_language in access exclusive mode',
  )
  for (let index = 0; index < 12; index += 1) {
    requests.push(
      fetch(`${web.origin}/api/player/config`, { signal: AbortSignal.timeout(10_000) }),
    )
    requests.push(worker.control('/ready'))
    requests.push(worker.control('/subtitles/ready'))
  }
  // Attach rejection handlers immediately, including when the regression fails.
  const responses = Promise.allSettled(requests)
  async function connections() {
    return (
      await database.pool.query(
        `select application_name as name, count(*)::int as total,
       count(*) filter (where wait_event_type='Lock')::int as blocked
       from pg_stat_activity where application_name=any($1) group by application_name`,
        [[`${prefix}-web`, `${prefix}-worker`]],
      )
    ).rows
  }
  await until(
    async () => {
      const rows = await connections()
      return (
        rows.some((row) => row.name.endsWith('-web') && row.blocked >= 2) &&
        rows.some((row) => row.name.endsWith('-worker') && row.blocked >= 4)
      )
    },
    'both real services saturated against the held tables',
    1_500,
  )
  const peak = { web: 0, worker: 0 }
  for (let sample = 0; sample < 10; sample += 1) {
    for (const row of await connections()) {
      const component = row.name.endsWith('-web') ? 'web' : 'worker'
      peak[component] = Math.max(peak[component], row.total)
    }
    await delay(20)
  }
  // Web: one runtime pool plus supervisor. Worker: three isolated runtime pools
  // plus supervisor; the source pool retains room-control capacity independently.
  t.diagnostic(
    `Observed PostgreSQL connections: web=${peak.web}, worker=${peak.worker}`,
  )
  assert.ok(peak.web <= 3, `Web exceeded its database budget: ${peak.web} > 3`)
  assert.ok(peak.worker <= 7, `Worker exceeded its database budget: ${peak.worker} > 7`)
  await held.query('commit')
  held.release()
  held = undefined
  for (const result of await responses) {
    assert.equal(result.status, 'fulfilled')
    assert.equal(result.value.status, 200)
    const body = await result.value.json()
    assert.ok(body.ready === true || body.entryAvailable === true)
  }
  await Promise.all([web.close(), worker.close()])
  await until(
    async () => (await connections()).length === 0,
    'all process database sessions released',
  )
})

test('invalid pool settings fail configured web and worker startup before serving traffic', async () => {
  const database = await isolatedDatabase()
  await seedLegacyRoom(database.url)
  try {
    for (const [component, key, value] of [
      ['web', 'NUXT_DATABASE_POOL_MAX', '0'],
      ['web', 'NUXT_DATABASE_POOL_MAX', '1.5'],
      ['web', 'NUXT_DATABASE_POOL_MAX', 'not-a-size'],
      ['worker', 'DATABASE_POOL_MAX', '1'],
    ]) {
      const entry =
        component === 'web'
          ? 'apps/web/.output/server/supervisor.mjs'
          : 'apps/voice-worker/dist/index.mjs'
      const child = spawn(process.execPath, [entry], {
        env: {
          ...process.env,
          DATABASE_URL: database.url,
          NUXT_DATABASE_URL: database.url,
          MEDIA_CONTROL_SECRET: randomBytes(32).toString('base64url'),
          MEDIA_CONTROL_PORT: '0',
          HOST: '127.0.0.1',
          PORT: '0',
          [key]: value,
        },
        stdio: 'ignore',
      })
      const exited = once(child, 'exit')
      let result
      try {
        result = await Promise.race([exited, delay(2_000, null, { ref: false })])
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM')
          await Promise.race([exited, delay(7_000, null, { ref: false })])
          if (child.exitCode === null && child.signalCode === null) {
            child.kill('SIGKILL')
            await exited
          }
        }
      }
      assert.deepEqual(result, [1, null], `${component} accepted invalid pool size`)
    }
  } finally {
    await database.close()
  }
})
