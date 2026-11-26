import {
  mediaOfferSchema,
  subtitleHistorySchema,
  voiceSourceStatusSchema,
  type ListenerReference,
  type MediaRequest,
  type SubtitleHistory,
} from '@babel/contracts'
import { mediaConnectionsStopped } from '@babel/database/listeners'
import {
  listActiveVoiceWorkers,
  readMediaConnectionOwnerUrl,
  readOpenMediaConnectionOwnerUrls,
} from '@babel/database/runtime-owners'
import { readRoomVoiceOwner, readUplinkHost } from '@babel/database/voice-sources'
import { useDatabase } from './database'

function controlSettings() {
  const config = useRuntimeConfig()
  if (!config.mediaControlUrl || !config.mediaControlSecret) {
    return null
  }
  return {
    fallbackUrl: config.mediaControlUrl,
    secret: config.mediaControlSecret,
  }
}

function optionalDatabase() {
  try {
    return useDatabase()
  } catch {
    return null
  }
}

async function controlAt(
  baseUrl: string,
  secret: string,
  path: string,
  body?: unknown,
  timeout = 8_000,
) {
  try {
    const destination = new URL(path, baseUrl)
    if (!['http:', 'https:'].includes(destination.protocol)) {
      return null
    }
    const response = await fetch(destination, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
      redirect: 'error',
    })
    const data: unknown = await response.json()
    return { status: response.status, data }
  } catch {
    // Never expose the private endpoint, control secret, listener credential,
    // SDP, or a transport exception in an HTTP error or application log.
    return null
  }
}

function flag(data: unknown, key: string) {
  return (
    typeof data === 'object' &&
    data !== null &&
    key in data &&
    Reflect.get(data, key) === true
  )
}

async function activeWorkerPool() {
  const db = optionalDatabase()
  if (!db) {
    return []
  }
  try {
    return await listActiveVoiceWorkers(db)
  } catch {
    return []
  }
}

/**
 * Resolves the worker endpoint owning a room's voice/subtitle source, falling
 * back to any registered worker or the configured single-worker URL.
 */
export async function resolveRoomControlUrl(roomId: string) {
  const settings = controlSettings()
  if (!settings) {
    return null
  }
  const db = optionalDatabase()
  if (db) {
    try {
      const owner = await readRoomVoiceOwner(db, roomId)
      if (owner?.controlUrl) {
        return owner.controlUrl
      }
      const workers = await listActiveVoiceWorkers(db)
      if (workers[0]) {
        return workers[0].controlUrl
      }
    } catch {
      /* Fall back to configured control URL when worker discovery is unavailable. */
    }
  }
  return settings.fallbackUrl
}

function rankWorkersByLoad(
  workers: Awaited<ReturnType<typeof listActiveVoiceWorkers>>,
) {
  const randomized = workers.map((worker) => ({ worker, tie: Math.random() }))
  randomized.sort(
    (a, b) => a.worker.activeConnections - b.worker.activeConnections || a.tie - b.tie,
  )
  return randomized.map((item) => item.worker.controlUrl)
}

export async function mediaReady() {
  const settings = controlSettings()
  if (!settings) {
    return false
  }
  const workers = await activeWorkerPool()
  const urls = workers.length
    ? workers.map((worker) => worker.controlUrl)
    : [settings.fallbackUrl]
  const results = await Promise.all(
    urls.map((url) => controlAt(url, settings.secret, '/ready')),
  )
  return results.some((result) => result?.status === 200 && flag(result.data, 'ready'))
}

export async function subtitlesReady() {
  const settings = controlSettings()
  if (!settings) {
    return false
  }
  const workers = await activeWorkerPool()
  const urls = workers.length
    ? workers.map((worker) => worker.controlUrl)
    : [settings.fallbackUrl]
  const results = await Promise.all(
    urls.map((url) =>
      controlAt(url, settings.secret, '/subtitles/ready', undefined, 2_000),
    ),
  )
  return results.some((result) => result?.status === 200 && flag(result.data, 'ready'))
}

export async function voiceSourceStatus(roomId: string) {
  const settings = controlSettings()
  if (!settings) {
    return null
  }
  const baseUrl = await resolveRoomControlUrl(roomId)
  if (!baseUrl) {
    return null
  }
  const result = await controlAt(baseUrl, settings.secret, '/source', { roomId }, 2_000)
  if (result?.status !== 200) {
    return null
  }
  const parsed = voiceSourceStatusSchema.safeParse(result.data)
  return parsed.success && parsed.data.roomId === roomId ? parsed.data : null
}

export async function revokeMedia(reference: ListenerReference) {
  const settings = controlSettings()
  if (!settings) {
    return false
  }
  const db = optionalDatabase()
  if (!db) {
    const result = await controlAt(
      settings.fallbackUrl,
      settings.secret,
      '/revoke',
      reference,
    )
    return result?.status === 200 && flag(result.data, 'stopped')
  }
  const open = await readOpenMediaConnectionOwnerUrls(db, reference)
  const targets = new Set<string>()
  for (const row of open) {
    targets.add(row.controlUrl ?? settings.fallbackUrl)
  }
  if (!targets.size) {
    const workers = await activeWorkerPool()
    if (workers.length) {
      for (const worker of workers) {
        targets.add(worker.controlUrl)
      }
    } else {
      targets.add(settings.fallbackUrl)
    }
  }
  const results = await Promise.all(
    [...targets].map((url) => controlAt(url, settings.secret, '/revoke', reference)),
  )
  if (!open.length) {
    return results.some(
      (result) => result?.status === 200 && flag(result.data, 'stopped'),
    )
  }
  return mediaConnectionsStopped(db, reference)
}

async function resolveMediaTargets(
  reference: ListenerReference & { roomId?: string; nickname?: string },
  request: MediaRequest,
  fallbackUrl: string,
): Promise<string[]> {
  const db = optionalDatabase()
  if (!db) {
    return [fallbackUrl]
  }
  if (request.operation !== 'offer') {
    const owner = await readMediaConnectionOwnerUrl(db, request.connectionId)
    if (owner?.controlUrl) {
      return [owner.controlUrl]
    }
    const workers = await activeWorkerPool()
    if (workers.length && owner) {
      // The owning replica already exited; do not misroute answer/close elsewhere.
      return []
    }
    return [fallbackUrl]
  }
  const workers = await activeWorkerPool()
  if (reference.roomId && reference.nickname) {
    const host = await readUplinkHost(db, reference.roomId)
    if (host !== null && host === reference.nickname.normalize('NFC')) {
      const owner = await readRoomVoiceOwner(db, reference.roomId)
      if (owner?.controlUrl) {
        return [owner.controlUrl]
      }
      // In multi-worker mode, wait briefly for a replica to claim the room source
      // so the host uplink lands on the exact worker running PlayerSource.
      return workers.length ? [] : [fallbackUrl]
    }
  }
  if (workers.length) {
    return rankWorkersByLoad(workers)
  }
  return [fallbackUrl]
}

export async function mediaOperation(
  reference: ListenerReference & { roomId?: string; nickname?: string },
  credential: string,
  request: MediaRequest,
) {
  const settings = controlSettings()
  if (!settings) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Media connection unavailable',
    })
  }
  const targets = await resolveMediaTargets(reference, request, settings.fallbackUrl)
  const payload = {
    reference: {
      sessionId: reference.sessionId,
      nicknameGeneration: reference.nicknameGeneration,
    },
    credential,
    request,
  }
  const timeout = request.operation === 'offer' ? 20_000 : 8_000
  let result: { status: number; data: unknown } | null = null
  for (const url of targets) {
    result = await controlAt(url, settings.secret, '/media', payload, timeout)
    if (result && result.status !== 503) {
      break
    }
  }
  if (!result || result.status !== 200) {
    const status =
      result && [400, 404, 409, 410].includes(result.status) ? result.status : 503
    throw createError({
      statusCode: status,
      statusMessage: 'Media connection unavailable',
    })
  }
  if (request.operation === 'offer') {
    const parsed = mediaOfferSchema.safeParse(result.data)
    if (!parsed.success) {
      throw createError({ statusCode: 503, statusMessage: 'Media offer unavailable' })
    }
    return parsed.data
  }
  if (!flag(result.data, request.operation === 'answer' ? 'accepted' : 'closed')) {
    throw createError({ statusCode: 503, statusMessage: 'Media operation unconfirmed' })
  }
  return { accepted: true }
}

export async function subtitleHistory(
  reference: ListenerReference & { roomId?: string },
  credential: string,
): Promise<SubtitleHistory> {
  const settings = controlSettings()
  if (!settings) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Subtitle history unavailable',
    })
  }
  const baseUrl = reference.roomId
    ? await resolveRoomControlUrl(reference.roomId)
    : settings.fallbackUrl
  const result = baseUrl
    ? await controlAt(
        baseUrl,
        settings.secret,
        '/subtitles/history',
        {
          reference: {
            sessionId: reference.sessionId,
            nicknameGeneration: reference.nicknameGeneration,
          },
          credential,
        },
        5_000,
      )
    : null
  if (!result || result.status !== 200) {
    const status =
      result && [400, 401, 404, 410].includes(result.status) ? result.status : 503
    throw createError({
      statusCode: status,
      statusMessage: 'Subtitle history unavailable',
    })
  }
  const parsed = subtitleHistorySchema.safeParse(result.data)
  if (!parsed.success) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Subtitle history unavailable',
    })
  }
  return parsed.data
}
