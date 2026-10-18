import {
  mediaOfferSchema,
  voiceSourceStatusSchema,
  type ListenerReference,
  type MediaRequest,
} from '@babel/contracts'

async function control(path: string, body?: unknown, timeout = 8_000) {
  const config = useRuntimeConfig()
  if (!config.mediaControlUrl || !config.mediaControlSecret) {
    return null
  }
  try {
    const destination = new URL(path, config.mediaControlUrl)
    if (!['http:', 'https:'].includes(destination.protocol)) {
      return null
    }
    const response = await fetch(destination, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${config.mediaControlSecret}`,
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

export async function mediaReady() {
  const result = await control('/ready')
  return result?.status === 200 && flag(result.data, 'ready')
}

export async function subtitlesReady() {
  const result = await control('/subtitles/ready', undefined, 2_000)
  return result?.status === 200 && flag(result.data, 'ready')
}

export async function voiceSourceStatus(roomId: string) {
  const result = await control('/source', { roomId }, 2_000)
  if (result?.status !== 200) {
    return null
  }
  const parsed = voiceSourceStatusSchema.safeParse(result.data)
  return parsed.success && parsed.data.roomId === roomId ? parsed.data : null
}

export async function revokeMedia(reference: ListenerReference) {
  const result = await control('/revoke', reference)
  return result?.status === 200 && flag(result.data, 'stopped')
}

export async function mediaOperation(
  reference: ListenerReference,
  credential: string,
  request: MediaRequest,
) {
  const result = await control(
    '/media',
    { reference, credential, request },
    request.operation === 'offer' ? 20_000 : 8_000,
  )
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
