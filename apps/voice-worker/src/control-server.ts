import { createHash, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mediaControlRequestSchema, listenerReferenceSchema } from '@babel/contracts'
import { ListenerError } from '@babel/database/listeners'
import { MediaPeerError, type MediaPeers } from './media-peers.ts'

function digest(value: string) {
  return createHash('sha256').update(value).digest()
}

async function input(request: IncomingMessage) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (Buffer.byteLength(body) > 80 * 1024) {
      throw new MediaPeerError('UNAVAILABLE')
    }
  }
  return JSON.parse(body) as unknown
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

export function createControlServer(peers: MediaPeers, secret: string) {
  const expected = digest(`Bearer ${secret}`)
  const server = createServer(async (request, response) => {
    if (!timingSafeEqual(digest(request.headers.authorization ?? ''), expected)) {
      json(response, 401, { code: 'UNAUTHORIZED' })
      return
    }
    try {
      if (request.url === '/ready' && request.method === 'GET') {
        const ready = await peers.ready()
        json(response, ready ? 200 : 503, { ready, audioState: 'STOPPED' })
        return
      }
      if (request.url === '/revoke' && request.method === 'POST') {
        const parsed = listenerReferenceSchema.safeParse(await input(request))
        if (!parsed.success) {
          json(response, 400, { code: 'INVALID_REQUEST' })
          return
        }
        json(response, 200, { stopped: await peers.revoke(parsed.data) })
        return
      }
      if (request.url !== '/media' || request.method !== 'POST') {
        json(response, 404, { code: 'NOT_FOUND' })
        return
      }
      const parsed = mediaControlRequestSchema.safeParse(await input(request))
      if (!parsed.success) {
        json(response, 400, { code: 'INVALID_REQUEST' })
        return
      }
      const { reference, credential, request: command } = parsed.data
      if (command.operation === 'offer') {
        json(
          response,
          200,
          await peers.offer(
            command.connectionId,
            command.attempt,
            reference,
            credential,
          ),
        )
      } else if (command.operation === 'answer') {
        await peers.answer(
          command.connectionId,
          reference,
          credential,
          command.description,
        )
        json(response, 200, { accepted: true })
      } else {
        await peers.disconnect(command.connectionId, reference, credential)
        json(response, 200, { closed: true })
      }
    } catch (error) {
      const code =
        error instanceof ListenerError || error instanceof MediaPeerError
          ? error.code
          : error instanceof SyntaxError
            ? 'INVALID_REQUEST'
            : 'UNAVAILABLE'
      const status =
        code === 'INVALID_CREDENTIAL'
          ? 401
          : code === 'SESSION_ENDED'
            ? 410
            : code === 'ENTRY_CONFLICT' || code === 'BUSY'
              ? 409
              : code === 'NOT_FOUND'
                ? 404
                : code === 'INVALID_REQUEST'
                  ? 400
                  : 503
      json(response, status, { code })
    }
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 5_000
  return server
}
