import { createServer } from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import { createDatabase } from '@babel/database'
import { Kubernetes } from './kubernetes.ts'
import { reconcile } from './reconcile.ts'

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  const namespace = process.env.BABEL_RUNTIME_POD_NAMESPACE
  if (!databaseUrl || !namespace) {
    throw new Error('Recovery configuration is missing')
  }
  const kubernetes = new Kubernetes(namespace)
  const database = createDatabase(databaseUrl, {
    maxConnections: 1,
    queryTimeoutMs: 5_000,
  })
  database.pool.on('error', () => console.error('Recovery storage unavailable.'))
  const shutdown = new AbortController()
  const stop = () => shutdown.abort()
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  let lastSuccess = 0
  let unavailable = false
  const health = createServer((request, response) => {
    const ready = Date.now() - lastSuccess < 15_000
    response.statusCode =
      request.url === '/health/live'
        ? 200
        : request.url === '/health/ready'
          ? ready
            ? 200
            : 503
          : 404
    response.end(response.statusCode === 200 ? 'ok' : 'unavailable')
  })
  await new Promise<void>((resolve, reject) => {
    health.once('error', reject)
    health.listen(3200, '0.0.0.0', resolve)
  })
  try {
    while (!shutdown.signal.aborted) {
      try {
        await reconcile(database.db, kubernetes)
        lastSuccess = Date.now()
        if (unavailable) {
          console.log('Recovery dependencies available.')
        }
        unavailable = false
      } catch {
        if (!unavailable) {
          console.error('Recovery awaiting database or Kubernetes confirmation.')
        }
        unavailable = true
      }
      await delay(2_000, undefined, { signal: shutdown.signal }).catch(() => {})
    }
  } finally {
    process.off('SIGTERM', stop)
    process.off('SIGINT', stop)
    await new Promise<void>((resolve) => health.close(() => resolve()))
    await database.close()
  }
}

main().catch(() => {
  console.error('Recovery service could not start.')
  process.exitCode = 1
})
