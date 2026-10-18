import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import dgram from 'node:dgram'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

export async function until(predicate, label, timeout = 10_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const result = await predicate()
    if (result) {
      return result
    }
    await delay(30)
  }
  throw new Error(`Timed out: ${label}`)
}

export async function startMediaWorker(databaseUrl, secret, previousPort) {
  let port = previousPort
  if (!port) {
    const probe = createServer()
    probe.listen(0, '127.0.0.1')
    await once(probe, 'listening')
    port = probe.address().port
    await new Promise((resolve) => probe.close(resolve))
  }
  const child = spawn(process.execPath, ['apps/voice-worker/dist/index.mjs'], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: {
      ...process.env,
      NODE_ENV: 'production',
      DATABASE_URL: databaseUrl,
      MEDIA_CONTROL_SECRET: secret,
      MEDIA_CONTROL_PORT: String(port),
      MEDIA_CONTROL_HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let runtime = { pid: child.pid }
  const lines = createInterface({ input: child.stdout })
  lines.on('line', (line) => {
    try {
      const event = JSON.parse(line)
      if (event.mediaControlListening && Number.isInteger(event.runtimePid)) {
        runtime = { pid: event.runtimePid, ownerId: event.ownerId }
      }
    } catch {
      /* Never expose raw process output, which can contain credentials. */
    }
  })
  child.stderr.resume()
  const exited = once(child, 'exit')
  const origin = `http://127.0.0.1:${port}`
  async function close(signal = 'SIGTERM') {
    if (child.exitCode !== null || child.signalCode !== null) {
      return
    }
    child.kill(signal)
    await Promise.race([exited, delay(10_000, undefined, { ref: false })])
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await exited
    }
  }
  async function control(path, body) {
    return fetch(`${origin}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
  }
  try {
    await until(async () => {
      assert.equal(child.exitCode, null, 'Worker exited before readiness')
      try {
        return (await control('/ready')).ok
      } catch {
        return false
      }
    }, 'media worker readiness')
    return { origin, port, close, control, runtime: () => runtime }
  } catch (error) {
    await close()
    throw error
  }
}

export function candidateSockets(offer) {
  const endpoints = offer.description.sdp
    .split(/\r?\n/)
    .filter((line) => line.startsWith('a=candidate:'))
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields[2]?.toLowerCase() === 'udp' && fields[7] === 'host')
    .map((fields) => ({ address: fields[4], port: Number(fields[5]) }))
  assert.ok(endpoints.length > 0, 'No actual UDP candidate was advertised')
  return endpoints
}

export async function portsBusy(endpoints) {
  const states = await Promise.all(
    endpoints.map(
      ({ address, port }) =>
        new Promise((resolve, reject) => {
          const socket = dgram.createSocket('udp4')
          socket.once('error', (error) => {
            socket.close()
            if (error.code === 'EADDRINUSE') {
              resolve(true)
            } else {
              reject(new Error('Cannot inspect local candidate socket'))
            }
          })
          socket.bind(port, address, () => socket.close(() => resolve(false)))
        }),
    ),
  )
  return states.every(Boolean)
}

export async function portsReleased(endpoints) {
  const states = await Promise.all(endpoints.map((endpoint) => portsBusy([endpoint])))
  return states.every((busy) => !busy)
}
