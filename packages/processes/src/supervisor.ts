import { randomUUID } from 'node:crypto'
import { fork, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createDatabase } from '@babel/database'
import {
  confirmRuntimeExit,
  registerRuntimeOwner,
} from '@babel/database/runtime-owners'

export async function superviseRuntime(options: {
  databaseUrl: string
  moduleUrl: URL
  component: 'voice-worker' | 'web'
}) {
  const database = createDatabase(options.databaseUrl, {
    queryTimeoutMs: 2_000,
    maxConnections: 1,
  })
  database.pool.on('error', () => {
    console.error('Babel supervisor storage connection unavailable.')
  })
  let stopping = false
  const shutdown = new AbortController()
  let child: ChildProcess | undefined
  let deadline: ReturnType<typeof setTimeout> | undefined
  function stop() {
    stopping = true
    shutdown.abort()
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM')
      deadline ??= setTimeout(() => child?.kill('SIGKILL'), 5_000)
    }
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  async function persist(operation: () => Promise<void>, registering = false) {
    let reported = false
    for (;;) {
      try {
        await operation()
        return true
      } catch {
        if (registering && stopping) {
          return false
        }
        if (!reported) {
          console.error('Babel supervisor awaiting durable ownership confirmation.')
          reported = true
        }
        // Do not start a replacement while the old exit receipt is uncertain.
        await delay(1_000)
      }
    }
  }
  let failures = 0
  try {
    while (!stopping) {
      const ownerId = randomUUID()
      if (!(await persist(() => registerRuntimeOwner(database.db, ownerId), true))) {
        break
      }
      if (stopping) {
        // The reserved incarnation never started and owns no transports.
        await persist(() => confirmRuntimeExit(database.db, ownerId))
        break
      }
      const startedAt = performance.now()
      child = fork(fileURLToPath(options.moduleUrl), {
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      })
      const current = child
      const exited = new Promise<void>((resolve) => {
        current.once('exit', () => resolve())
        current.on('error', () => {
          if (current.pid === undefined) {
            // Spawn failed: no process ever owned this reserved incarnation.
            resolve()
          } else {
            current.kill('SIGKILL')
          }
        })
      })
      current.send({ type: 'start', ownerId }, (error) => {
        if (error) {
          current.kill('SIGKILL')
        }
      })
      if (stopping) {
        stop()
      }
      await exited
      clearTimeout(deadline)
      deadline = undefined
      child = undefined
      console.log(
        JSON.stringify({
          runtimeExited: true,
          component: options.component,
          ownerId,
          exitCode: current.exitCode,
          signal: current.signalCode,
        }),
      )
      // Exit is OS confirmation that every socket/thread owned by this child is
      // gone. Holding the owner lock also fences its delayed PostgreSQL work.
      await persist(() => confirmRuntimeExit(database.db, ownerId))
      if (!stopping) {
        failures = performance.now() - startedAt > 60_000 ? 0 : failures + 1
        await delay(
          Math.min(30_000, 1_000 * 2 ** Math.min(failures - 1, 5)),
          undefined,
          {
            signal: shutdown.signal,
          },
        ).catch(() => {})
      }
    }
  } finally {
    process.off('SIGTERM', stop)
    process.off('SIGINT', stop)
    clearTimeout(deadline)
    await database.close()
  }
}
