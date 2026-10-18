import { z } from 'zod'
import {
  entryRequestSchema,
  listenerCredentialSchema,
  listenerReferenceSchema,
  listenerSnapshotSchema,
} from '@babel/contracts'

const savedSessionSchema = listenerReferenceSchema.extend({
  credential: listenerCredentialSchema,
  leaving: z.boolean().default(false),
})
const pendingEntrySchema = z.object({
  request: entryRequestSchema,
  credential: listenerCredentialSchema,
})
export type SavedListener = z.infer<typeof savedSessionSchema>
export type PendingEntry = z.infer<typeof pendingEntrySchema>
const sessionKey = 'babel.listener'
const pendingKey = 'babel.pending-entry'

export function loadListener() {
  try {
    return savedSessionSchema.parse(
      JSON.parse(sessionStorage.getItem(sessionKey) ?? 'null'),
    )
  } catch {
    return null
  }
}

export function loadPendingEntry() {
  try {
    return pendingEntrySchema.parse(
      JSON.parse(sessionStorage.getItem(pendingKey) ?? 'null'),
    )
  } catch {
    return null
  }
}

export function saveListener(listener: SavedListener | null) {
  if (listener) {
    sessionStorage.setItem(sessionKey, JSON.stringify(listener))
  } else {
    sessionStorage.removeItem(sessionKey)
  }
}

export function savePendingEntry(pending: PendingEntry | null) {
  if (pending) {
    sessionStorage.setItem(pendingKey, JSON.stringify(pending))
  } else {
    sessionStorage.removeItem(pendingKey)
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
  constructor(readonly status: number) {
    super('Player request failed')
  }
}

export async function listenerRequest(
  path: string,
  credential: string,
  method = 'GET',
  body?: unknown,
) {
  const response = await fetch(path, {
    method,
    headers: {
      authorization: `Bearer ${credential}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new PlayerApiError(response.status)
  }
  return listenerSnapshotSchema.parse(await response.json())
}
