import { z } from 'zod'
import {
  entryRequestSchema,
  listenerCredentialSchema,
  listenerReferenceSchema,
  listenerSnapshotSchema,
  mediaOfferSchema,
  type MediaRequest,
} from '@babel/contracts'

const savedSessionSchema = listenerReferenceSchema.extend({
  credential: listenerCredentialSchema,
  leaving: z.boolean().default(false),
  mediaAttempt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).default(0),
})
const pendingEntrySchema = z.object({
  request: entryRequestSchema,
  credential: listenerCredentialSchema,
})
export type SavedListener = z.infer<typeof savedSessionSchema>
export type PendingEntry = z.infer<typeof pendingEntrySchema>
const sessionKey = 'babel.listener'
const pendingKey = 'babel.pending-entry'

export function loadListener(roomId?: string) {
  try {
    return savedSessionSchema.parse(
      JSON.parse(
        sessionStorage.getItem(roomId ? `${sessionKey}.${roomId}` : sessionKey) ??
          'null',
      ),
    )
  } catch {
    return null
  }
}

export function loadPendingEntry(roomId?: string) {
  try {
    return pendingEntrySchema.parse(
      JSON.parse(
        sessionStorage.getItem(roomId ? `${pendingKey}.${roomId}` : pendingKey) ??
          'null',
      ),
    )
  } catch {
    return null
  }
}

export function saveListener(listener: SavedListener | null, roomId?: string) {
  if (listener) {
    sessionStorage.setItem(
      roomId ? `${sessionKey}.${roomId}` : sessionKey,
      JSON.stringify(listener),
    )
  } else {
    sessionStorage.removeItem(roomId ? `${sessionKey}.${roomId}` : sessionKey)
  }
}

export function savePendingEntry(pending: PendingEntry | null, roomId?: string) {
  if (pending) {
    sessionStorage.setItem(
      roomId ? `${pendingKey}.${roomId}` : pendingKey,
      JSON.stringify(pending),
    )
  } else {
    sessionStorage.removeItem(roomId ? `${pendingKey}.${roomId}` : pendingKey)
  }
}

export function createPendingEntry(
  nickname: string,
  outputLanguage: string | null,
): PendingEntry {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const credential = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
  return {
    request: { nickname, outputLanguage, requestId: crypto.randomUUID() },
    credential,
  }
}

export function savedLanguage() {
  try {
    return localStorage.getItem('babel.output-language')
  } catch {
    return null
  }
}

export function saveLanguage(language: string | null) {
  try {
    if (language) {
      localStorage.setItem('babel.output-language', language)
    } else {
      localStorage.removeItem('babel.output-language')
    }
  } catch {
    /* A blocked preference store does not end a listener session. */
  }
}

export class PlayerApiError extends Error {
  constructor(
    readonly status: number,
    message = 'Player request failed',
  ) {
    super(message)
  }
}

async function playerRequest(
  path: string,
  credential: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
  timeout = 10_000,
) {
  const response = await fetch(path, {
    method,
    headers: {
      authorization: `Bearer ${credential}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(timeout)])
      : AbortSignal.timeout(timeout),
  })
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null)
    const message =
      data &&
      typeof data === 'object' &&
      'statusMessage' in data &&
      typeof data.statusMessage === 'string'
        ? data.statusMessage
        : undefined
    throw new PlayerApiError(response.status, message)
  }
  return response.json() as Promise<unknown>
}

export async function listenerRequest(
  path: string,
  credential: string,
  method = 'GET',
  body?: unknown,
) {
  return listenerSnapshotSchema.parse(
    await playerRequest(path, credential, method, body),
  )
}

export async function requestListenerMedia(
  listener: SavedListener,
  request: MediaRequest,
  signal?: AbortSignal,
) {
  const result = await playerRequest(
    `/api/player/sessions/${listener.sessionId}/media`,
    listener.credential,
    'POST',
    request,
    signal,
    request.operation === 'offer' ? 25_000 : 10_000,
  )
  return request.operation === 'offer' ? mediaOfferSchema.parse(result) : null
}
