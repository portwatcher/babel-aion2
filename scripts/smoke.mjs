import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const probe = createServer()
probe.listen(0, '127.0.0.1')
await once(probe, 'listening')
const port = probe.address().port
await new Promise((resolve, reject) =>
  probe.close((error) => (error ? reject(error) : resolve())),
)
const origin = `http://127.0.0.1:${port}`
const server = spawn(process.execPath, ['apps/web/.output/server/index.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    NUXT_SITE_URL: origin,
    NUXT_DATABASE_URL: '',
    NUXT_BETTER_AUTH_SECRET: '',
    NUXT_ACCESS_TEAM_DOMAIN: 'babel-smoke.cloudflareaccess.com',
    NUXT_ACCESS_AUDIENCE: 'babel-smoke',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let output = ''
server.stdout.on('data', (data) => {
  output += data
})
server.stderr.on('data', (data) => {
  output += data
})

try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      ready = (
        await fetch(`${origin}/api/health/live`, { signal: AbortSignal.timeout(1_000) })
      ).ok
      if (ready) {
        break
      }
    } catch {
      /* Wait for the built server to bind its port. */
    }
    if (server.exitCode !== null) {
      throw new Error(output)
    }
    await setTimeout(100)
  }
  assert.ok(ready, `Built server did not become ready: ${output}`)
  assert.equal((await fetch(origin)).status, 200)
  const configuration = await (await fetch(`${origin}/api/player/config`)).json()
  assert.deepEqual(configuration.outputLanguages, [])
  assert.equal(configuration.entryAvailable, false)
  for (const path of [
    '/admin',
    '/admin/settings',
    '/api/management/status',
    '/api/auth/get-session',
  ]) {
    assert.equal((await fetch(`${origin}${path}`)).status, 401, path)
    const forged = await fetch(`${origin}${path}`, {
      headers: {
        'cf-access-jwt-assertion': 'fabricated',
        'cf-access-authenticated-user-email': 'operator@example.test',
      },
    })
    assert.equal(forged.status, 403, `${path}: forged identity`)
  }
  const entry = await fetch(`${origin}/api/player/sessions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nickname: '玩家',
      outputLanguage: null,
      requestId: crypto.randomUUID(),
    }),
  })
  assert.equal(entry.status, 503)
  assert.equal((await fetch(`${origin}/api/health/ready`)).status, 503)
  console.log(
    'PASS built HTTP smoke: public lobby, empty languages, Access boundaries, closed entry and readiness.',
  )
} finally {
  const exited = once(server, 'exit')
  server.kill('SIGTERM')
  await Promise.race([exited, setTimeout(3_000)])
  if (server.exitCode === null && server.signalCode === null) {
    server.kill('SIGKILL')
    await exited
  }
}
