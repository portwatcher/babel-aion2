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
