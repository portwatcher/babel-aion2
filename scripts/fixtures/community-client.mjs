import { once } from 'node:events'
import WebSocket from 'ws'

export async function call(
  server,
  path,
  { method = 'GET', body, cookie, token, sessionId, origin = server.origin } = {},
) {
  return fetch(`${server.origin}${path}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(method === 'GET' ? {} : { origin }),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(sessionId ? { 'x-listener-session': sessionId } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
}

export function map(server, roomId, listener, method = 'GET', body, suffix = '') {
  return call(server, `/api/player/rooms/${roomId}/map${suffix}`, {
    method,
    body,
    token: listener.token,
    sessionId: listener.sessionId,
  })
}

/** The authenticated player socket; collects pushed map revisions. */
export async function mapRevisions(server, listener) {
  const socket = new WebSocket(
    `${server.origin.replace('http:', 'ws:')}/api/player/ws`,
    {
      headers: { origin: server.origin },
    },
  )
  const revisions = []
  socket.on('message', (data) => {
    const event = JSON.parse(data.toString())
    if (event.type === 'map') {
      revisions.push(event.revision)
    } else if (event.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', nonce: event.nonce }))
    }
  })
  await once(socket, 'open')
  socket.send(
    JSON.stringify({
      type: 'authenticate',
      sessionId: listener.sessionId,
      credential: listener.token,
    }),
  )
  async function changed(label) {
    const known = revisions.length
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      if (revisions.length > known) {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error(`Timed out: ${label}`)
  }
  return { revisions, changed, close: () => socket.close() }
}
