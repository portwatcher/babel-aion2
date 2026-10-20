import { randomUUID } from 'node:crypto'
import { assertSameOrigin } from '@babel/auth/access'
import {
  playerMessageSchema,
  type ListenerSnapshot,
  type PlayerEvent,
} from '@babel/contracts'
import {
  closePlayerConnection,
  openPlayerConnection,
  readPlayerConnection,
  readPlayerConnections,
  renewPlayerConnection,
  subtitleConnectionsStopped,
  ListenerError,
  type ListenerDelivery,
} from '@babel/database/listeners'
import type { Hooks, Peer } from 'crossws'
import { useDatabase } from './database'
import { createRoomViews, type RoomView } from './room-views'
import { mediaReady, revokeMedia } from './media-control'
import { createSubtitleRelay } from './subtitle-relay'
import { SubtitleLatencyProbes } from './subtitle-latency'
import { playerRuntimeOwner, playerRuntimeReady } from './runtime-owner'

interface Connection {
  peer: Peer
  session: ListenerSnapshot | null
  authenticating: boolean
  closed: boolean
  closing: boolean
  lastState: string
  lastPlayers: string
  lastConfiguration: string
  lastMap: string
  nonce: string | null
  pingAt: number
  pongAt: number
  rttMs: number | null
  probes: SubtitleLatencyProbes
  timeout: ReturnType<typeof setTimeout>
  acknowledgeClose: () => void
  closedPromise: Promise<void>
  subtitles: ReturnType<typeof createSubtitleRelay> | null
}

const connections = new Map<string, Connection>()
class PlayerProtocolError extends Error {}
let timer: ReturnType<typeof setInterval> | undefined
let running: Promise<void> | undefined

/** One sweep's verified sessions and lazily shared room snapshots. */
interface SweepContext {
  sessions: Map<string, ListenerSnapshot>
  room(roomId: string): Promise<RoomView>
}

function send(connection: Connection, event: PlayerEvent) {
  sendText(connection, JSON.stringify(event))
}

function sendText(connection: Connection, text: string) {
  if (connection.closed || connection.closing) {
    return
  }
  if ((connection.peer.websocket.bufferedAmount ?? 0) > 64 * 1024) {
    end(connection, 1013, 'Connection too slow')
    return
  }
  connection.peer.send(text)
}

function end(connection: Connection, code: number, reason: string) {
  if (connection.closing || connection.closed) {
    return
  }
  connection.closing = true
  connection.subtitles?.stop()
  connection.probes.clear()
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
    await closePlayerConnection(useDatabase(), connection.peer.id, playerRuntimeOwner())
  }
  connections.delete(connection.peer.id)
  connection.acknowledgeClose()
}

async function refresh(connection: Connection, context?: SweepContext) {
  if (connection.closed) {
    await persistClose(connection)
    return
  }
  if (connection.closing || !connection.session) {
    return
  }
  const reference = connection.session
  const session = context
    ? context.sessions.get(reference.sessionId)
    : await readPlayerConnection(useDatabase(), reference)
  if (!session || session.nicknameGeneration !== reference.nicknameGeneration) {
    end(connection, 4401, 'Invalid listener')
    return
  }
  sendSession(connection, session)
  if (connection.closing) {
    return
  }
  connection.subtitles?.update(session)
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
  // Room snapshots are informational, not authorization: a failed read skips
  // this update instead of closing a verified socket.
  const view = await (context ?? createSweepContext(new Map()))
    .room(session.roomId)
    .catch(() => null)
  if (!view || connection.closing) {
    return
  }
  if (view.players !== connection.lastPlayers) {
    sendText(connection, view.players)
    connection.lastPlayers = view.players
  }
  if (view.configuration !== connection.lastConfiguration) {
    sendText(connection, view.configuration)
    connection.lastConfiguration = view.configuration
  }
  if (view.map !== null && view.map !== connection.lastMap) {
    sendText(connection, view.map)
    connection.lastMap = view.map
  }
}

function createSweepContext(sessions: Map<string, ListenerSnapshot>): SweepContext {
  return { sessions, room: createRoomViews() }
}

async function sweep() {
  const all = [...connections.values()]
  const verified = new Set(
    all.filter(
      (connection) => connection.session && !connection.closed && !connection.closing,
    ),
  )
  // One query verifies every socket on this replica; room data is read once per room.
  let context: SweepContext | null = null
  try {
    context = createSweepContext(
      await readPlayerConnections(
        useDatabase(),
        [...verified].flatMap((connection) =>
          connection.session ? [connection.session] : [],
        ),
      ),
    )
  } catch {
    /* Each verified socket below fails closed. */
  }
  await Promise.allSettled(
    all.map(async (connection) => {
      try {
        if (!verified.has(connection)) {
          // Authenticated after the batch read: verify it individually.
          await refresh(connection)
          return
        }
        if (!context) {
          throw new Error('Listener storage unavailable')
        }
        await refresh(connection, context)
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
  await running
  // Keep unconfirmed registrations in PostgreSQL if a shutdown cannot be proved.
}

export const playerListenerDelivery: ListenerDelivery = {
  ready: async () => (await playerRuntimeReady()) && mediaReady(),
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
  async upgrade(request) {
    try {
      assertSameOrigin(request.headers.get('origin'), useRuntimeConfig().siteUrl)
    } catch {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      if (await playerRuntimeReady()) {
        return
      }
    } catch {
      /* Storage failure cannot authorize an unverified transport owner. */
    }
    return new Response('Unavailable', { status: 503 })
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
      lastMap: '',
      nonce: null,
      pingAt: 0,
      pongAt: Date.now(),
      rttMs: null,
      probes: new SubtitleLatencyProbes(),
      acknowledgeClose,
      closedPromise,
      subtitles: null,
      timeout: setTimeout(
        () => end(connection, 4401, 'Authentication required'),
        5_000,
      ),
    }
    connection.timeout.unref()
    connection.subtitles = createSubtitleRelay(peer.id, (event, latency) => {
      if (!latency || event.type !== 'subtitles') {
        send(connection, event)
        return
      }
      connection.probes.relay(
        latency.value,
        event.outputLanguage,
        latency.receivedAt,
        (probe) => send(connection, { ...event, probe }),
      )
    })
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
            playerRuntimeOwner(),
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
      } else if (input.data.type === 'subtitle-displayed') {
        if (!connection.session) {
          throw new PlayerProtocolError('Invalid message')
        }
        // Unknown, repeated or expired probes are ignored rather than trusted.
        connection.probes.displayed(
          input.data.probe,
          input.data.renderDelayMs,
          input.data.visible,
          connection.rttMs,
        )
      } else {
        if (!connection.session || input.data.nonce !== connection.nonce) {
          throw new PlayerProtocolError('Invalid heartbeat')
        }
        connection.nonce = null
        connection.pongAt = Date.now()
        connection.rttMs = connection.pongAt - connection.pingAt
        await renewPlayerConnection(useDatabase(), peer.id, playerRuntimeOwner())
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
    connection.subtitles?.stop()
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
