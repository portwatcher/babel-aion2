import type { Pool, PoolClient, QueryResultRow } from 'pg'

export class VoiceSourceOwnershipError extends Error {
  constructor() {
    super('Voice source ownership unavailable')
  }
}

interface Holder {
  lost(): void
}

/**
 * One dedicated PostgreSQL session holds the session advisory locks of every
 * voice source this process controls. Losing the session loses every lock, so
 * every holder is invalidated together. Within the process a control key has at
 * most one holder; advisory locks alone would be reentrant on a shared session.
 */
// A closed connection fails the session at once. A health check that merely
// exceeds its bound is retried: slowness is not proof the session ended, and the
// open run receipt keeps fencing other processes meanwhile.
const MAX_SLOW_CHECKS = 3

class LockSession {
  readonly holders = new Map<string, Holder>()
  dead = false
  private checking = false
  private slowChecks = 0
  private queue: Promise<unknown> = Promise.resolve()
  private readonly timer: ReturnType<typeof setInterval>

  constructor(
    private readonly client: PoolClient,
    private readonly retired: (session: LockSession) => void,
  ) {
    client.on('error', this.fail)
    client.on('end', this.fail)
    this.timer = setInterval(() => {
      if (this.checking || this.dead) {
        return
      }
      this.checking = true
      void this.query('select 1')
        .then(
          () => {
            this.slowChecks = 0
          },
          () => {
            this.slowChecks += 1
            if (this.slowChecks >= MAX_SLOW_CHECKS) {
              this.fail()
            }
          },
        )
        .finally(() => {
          this.checking = false
        })
    }, 500)
    this.timer.unref()
  }

  readonly fail = () => {
    if (this.dead) {
      return
    }
    this.destroy()
    for (const holder of this.holders.values()) {
      holder.lost()
    }
  }

  /** Statements on the dedicated connection run one at a time, each bounded. */
  private query<T extends QueryResultRow>(text: string, values: string[] = []) {
    const run = this.queue.then(() => boundedQuery<T>(this.client, text, values))
    this.queue = run.catch(() => {})
    return run
  }

  async acquire(key: string) {
    const result = await this.query<{ acquired: boolean }>(
      'select pg_try_advisory_lock(hashtextextended($1, 0)) as acquired',
      [key],
    )
    return result.rows[0]?.acquired === true
  }

  async unlock(key: string) {
    if (this.dead) {
      return
    }
    try {
      await this.query('select pg_advisory_unlock(hashtextextended($1, 0))', [key])
    } catch {
      // Without confirmation, end the session: closing it releases every lock.
      this.fail()
    }
  }

  /** Ends the session once nothing holds a lock on it. */
  idle() {
    if (!this.holders.size && !this.dead) {
      this.destroy()
    }
  }

  private destroy() {
    this.dead = true
    clearInterval(this.timer)
    this.client.off('end', this.fail)
    // Destroy rather than return it to the pool, so no advisory lock survives.
    this.client.release(true)
    this.retired(this)
  }
}

const sessions = new WeakMap<Pool, Promise<LockSession>>()

async function lockSession(pool: Pool) {
  const existing = sessions.get(pool)
  if (existing) {
    const session = await existing
    if (!session.dead) {
      return session
    }
  }
  const created = pool.connect().then(
    (client) =>
      new LockSession(client, (session) => {
        void created.then((current) => {
          if (current === session && sessions.get(pool) === created) {
            sessions.delete(pool)
          }
        })
      }),
  )
  sessions.set(pool, created)
  created.catch(() => {
    if (sessions.get(pool) === created) {
      sessions.delete(pool)
    }
  })
  return created
}

/**
 * Takes exclusive control of `key` for this process and across processes.
 * `release` must be called exactly once, whether or not control was granted.
 */
export async function lockVoiceSource(pool: Pool, key: string, lost: () => void) {
  const session = await lockSession(pool)
  if (session.holders.has(key)) {
    throw new VoiceSourceOwnershipError()
  }
  const holder: Holder = { lost }
  // Reserve before the first await: a concurrent claim in this process is refused.
  session.holders.set(key, holder)
  let acquired = false
  let released = false
  async function release() {
    if (released) {
      return
    }
    released = true
    if (acquired) {
      await session.unlock(key)
    }
    if (session.holders.get(key) === holder) {
      session.holders.delete(key)
    }
    session.idle()
  }
  try {
    acquired = await session.acquire(key)
  } catch {
    session.fail()
  }
  if (!acquired || session.dead) {
    await release()
    throw new VoiceSourceOwnershipError()
  }
  return { valid: () => !released && !session.dead, release }
}

export async function boundedQuery<T extends QueryResultRow>(
  client: PoolClient,
  text: string,
  values: string[] = [],
) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      client.query<T>(text, values),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new VoiceSourceOwnershipError()), 1_500)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
