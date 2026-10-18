import { randomUUID } from 'node:crypto'
import { assertSameOrigin } from '@babel/auth/access'
import {
  playerMessageSchema,
  type ListenerSnapshot,
  type PlayerEvent,
} from '@babel/contracts'
import {
  closePlayerConnection,
  listPublicListeners,
  openPlayerConnection,
  readPlayerConnection,
  renewPlayerConnection,
  subtitleConnectionsStopped,
  ListenerError,
  type ListenerDelivery,
} from '@babel/database/listeners'
import type { Hooks, Peer } from 'crossws'
import { useDatabase } from './database'
import { publicRoomConfiguration } from './room-configuration'
import { mediaReady, revokeMedia } from './media-control'

interface Connection {
  peer: Peer
  session: ListenerSnapshot | null
  authenticating: boolean
  closed: boolean
  closing: boolean
  lastState: string
  lastPlayers: string
  lastConfiguration: string
  nonce: string | null
  pingAt: number
  pongAt: number
  timeout: ReturnType<typeof setTimeout>
  acknowledgeClose: () => void
  closedPromise: Promise<void>
}

const connections = new Map<string, Connection>()
class PlayerProtocolError extends Error {}
let timer: ReturnType<typeof setInterval> | undefined
let running: Promise<void> | undefined

function send(connection: Connection, event: PlayerEvent) {
  if (connection.closed || connection.closing) {
    return
  }
  if ((connection.peer.websocket.bufferedAmount ?? 0) > 64 * 1024) {
    end(connection, 1013, 'Connection too slow')
    return
  }
  connection.peer.send(JSON.stringify(event))
}

function end(connection: Connection, code: number, reason: string) {
  if (connection.closing || connection.closed) {
    return
  }
  connection.closing = true
  clearTimeout(connection.timeout)
  connection.peer.close(code, reason)
  connection.timeout = setTimeout(() => connection.peer.terminate(), 1_500)
  connection.timeout.unref()
}

function sendSession(connection: Connection, session: ListenerSnapshot) {
  const state = JSON.stringify(session)
  connection.session = session
  if (state !== connection.lastState) {
    send(connection, { type: 'session', session })
    connection.lastState = state
  }
  if (!['JOINING', 'ACTIVE'].includes(session.state)) {
    end(connection, 4409, 'Listener session ended')
  }
}

async function persistClose(connection: Connection) {
  // Only the close hook can set closed=true. A close request or a timer is not
  // proof that a socket stopped, and cannot acknowledge cross-replica revocation.
  if (!connection.closed || connection.authenticating) {
    return
  }
  if (connection.session) {
    await closePlayerConnection(useDatabase(), connection.peer.id)
  }
  connections.delete(connection.peer.id)
  connection.acknowledgeClose()
}

async function refresh(connection: Connection) {
  if (connection.closed) {
    await persistClose(connection)
    return
  }
  if (connection.closing || !connection.session) {
    return
  }
  const session = await readPlayerConnection(useDatabase(), connection.session)
  if (!session) {
    end(connection, 4401, 'Invalid listener')
    return
  }
  sendSession(connection, session)
  if (connection.closing) {
    return
  }
  const now = Date.now()
  if (now - connection.pongAt > 90_000) {
    end(connection, 4408, 'Heartbeat timeout')
    return
  }
  if (!connection.nonce && now - connection.pingAt >= 15_000) {
    connection.nonce = randomUUID()
    connection.pingAt = now
    send(connection, { type: 'ping', nonce: connection.nonce })
  }
  const players = await listPublicListeners(useDatabase(), session.roomId)
  const playersKey = JSON.stringify(players)
  if (playersKey !== connection.lastPlayers) {
    send(connection, { type: 'players', players })
    connection.lastPlayers = playersKey
  }
  const configuration = await publicRoomConfiguration()
  const configurationKey = JSON.stringify(configuration)
  if (configurationKey !== connection.lastConfiguration) {
    send(connection, { type: 'configuration', configuration })
    connection.lastConfiguration = configurationKey
  }
}

async function sweep() {
  await Promise.allSettled(
    [...connections.values()].map(async (connection) => {
      try {
        await refresh(connection)
      } catch {
        // A database failure never leaves an unverified delivery channel alive.
        send(connection, { type: 'error', code: 'UNAVAILABLE' })
        end(connection, 4503, 'Listener storage unavailable')
      }
    }),
  )
}

export function startPlayerChannels() {
  if (timer) {
    return
  }
  timer = setInterval(() => {
    if (!running && connections.size) {
      running = sweep().finally(() => {
        running = undefined
      })
    }
  }, 1_000)
  timer.unref()
}

export async function stopPlayerChannels() {
  clearInterval(timer)
  timer = undefined
  await running
  const closing = [...connections.values()]
  for (const connection of closing) {
    end(connection, 1012, 'Server restarting')
  }
  let deadline: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.all(closing.map((connection) => connection.closedPromise)),
    new Promise<void>((resolve) => {
      deadline = setTimeout(resolve, 2_000)
    }),
  ])
  clearTimeout(deadline)
  // Keep unconfirmed registrations in PostgreSQL if a shutdown cannot be proved.
}

export const playerListenerDelivery: ListenerDelivery = {
  ready: mediaReady,
  revokeMedia,
  async revokeSubtitles(reference) {
    for (const connection of connections.values()) {
      if (
        connection.session?.sessionId === reference.sessionId &&
        connection.session.nicknameGeneration === reference.nicknameGeneration
      ) {
        await refresh(connection)
      }
    }
    return subtitleConnectionsStopped(useDatabase(), reference)
  },
}

export const playerWebSocketHooks: Partial<Hooks> = {
  upgrade(request) {
    try {
      assertSameOrigin(request.headers.get('origin'), useRuntimeConfig().siteUrl)
    } catch {
      return new Response('Forbidden', { status: 403 })
    }
    if (!useRuntimeConfig().databaseUrl) {
      return new Response('Unavailable', { status: 503 })
    }
  },
  open(peer) {
    let acknowledgeClose = () => {}
    const closedPromise = new Promise<void>((resolve) => {
      acknowledgeClose = resolve
    })
    const connection: Connection = {
      peer,
      session: null,
      authenticating: false,
      closed: false,
      closing: false,
      lastState: '',
      lastPlayers: '',
      lastConfiguration: '',
      nonce: null,
      pingAt: 0,
      pongAt: Date.now(),
      acknowledgeClose,
      closedPromise,
      timeout: setTimeout(
        () => end(connection, 4401, 'Authentication required'),
        5_000,
      ),
    }
    connection.timeout.unref()
    connections.set(peer.id, connection)
  },
  async message(peer, message) {
    const connection = connections.get(peer.id)
    if (!connection || connection.closed || connection.closing) {
      return
    }
    try {
      if (message.uint8Array().byteLength > 2_048) {
        throw new PlayerProtocolError('Frame too large')
      }
      let payload: unknown
      try {
        payload = message.json()
      } catch {
        throw new PlayerProtocolError('Invalid JSON')
      }
      const input = playerMessageSchema.safeParse(payload)
      if (!input.success || connection.authenticating) {
        throw new PlayerProtocolError('Invalid message')
      }
      if (input.data.type === 'authenticate') {
        if (connection.session) {
          throw new PlayerProtocolError('Already authenticated')
        }
        connection.authenticating = true
        try {
          const session = await openPlayerConnection(
            useDatabase(),
            peer.id,
            input.data.sessionId,
            input.data.credential,
          )
          connection.session = session
          if (!connection.closing) {
            clearTimeout(connection.timeout)
          }
        } finally {
          connection.authenticating = false
        }
        if (connection.closed) {
          await persistClose(connection)
          return
        }
        await refresh(connection)
      } else {
        if (!connection.session || input.data.nonce !== connection.nonce) {
          throw new PlayerProtocolError('Invalid heartbeat')
        }
        connection.nonce = null
        connection.pongAt = Date.now()
        await renewPlayerConnection(useDatabase(), peer.id)
      }
    } catch (error) {
      const code =
        error instanceof ListenerError
          ? 'INVALID_CREDENTIAL'
          : error instanceof PlayerProtocolError
            ? 'INVALID_MESSAGE'
            : 'UNAVAILABLE'
      send(connection, { type: 'error', code })
      end(
        connection,
        code === 'INVALID_CREDENTIAL' ? 4401 : code === 'INVALID_MESSAGE' ? 4400 : 4503,
        code,
      )
    }
  },
  async close(peer) {
    const connection = connections.get(peer.id)
    if (!connection) {
      return
    }
    connection.closed = true
    clearTimeout(connection.timeout)
    try {
      await persistClose(connection)
    } catch {
      /* Retried by sweep; no false acknowledgement. */
    }
  },
  error(peer) {
    const connection = connections.get(peer.id)
    if (connection) {
      end(connection, 4503, 'Connection unavailable')
    }
  },
}
