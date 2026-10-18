import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

export async function startTestServer(databaseUrl = '', options = {}) {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const probe = createServer()
  probe.listen(0, '127.0.0.1')
  await once(probe, 'listening')
  const port = probe.address().port
  await new Promise((resolve, reject) =>
    probe.close((error) => (error ? reject(error) : resolve())),
  )
  const origin = `http://127.0.0.1:${port}`
  const imports = (options.nodeImports ?? []).flatMap((path) => ['--import', path])
  const processHandle = spawn(
    process.execPath,
    [...imports, 'apps/web/.output/server/index.mjs'],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        HOST: '127.0.0.1',
        PORT: String(port),
        NUXT_SITE_URL: origin,
        NUXT_DATABASE_URL: databaseUrl,
        NUXT_BETTER_AUTH_SECRET: '',
        NUXT_PROVIDER_ENCRYPTION_KEY: '',
        NUXT_ACCESS_TEAM_DOMAIN: 'babel-smoke.cloudflareaccess.com',
        NUXT_ACCESS_AUDIENCE: 'babel-smoke',
        ...options.environment,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  // Never include server logs or request data in assertions: a failing adapter
  // may accidentally log a secret. Report status/exit code only.
  processHandle.stdout.resume()
  processHandle.stderr.resume()
  const exited = once(processHandle, 'exit')
  async function close() {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null) {
      return
    }
    processHandle.kill('SIGTERM')
    await Promise.race([exited, setTimeout(3_000, undefined, { ref: false })])
    if (processHandle.exitCode === null && processHandle.signalCode === null) {
      processHandle.kill('SIGKILL')
      await exited
    }
  }
  try {
    let ready = false
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        ready = (
          await fetch(`${origin}/api/health/live`, {
            signal: AbortSignal.timeout(1_000),
          })
        ).ok
        if (ready) {
          break
        }
      } catch {
        /* Wait for the built server to bind. */
      }
      assert.equal(processHandle.exitCode, null, 'Built server exited before readiness')
      await setTimeout(100)
    }
    assert.ok(ready, 'Built server did not become ready')
    return { origin, close }
  } catch (error) {
    await close()
    throw error
  }
}
