import {
  subtitleMessageSchema,
  type ListenerSnapshot,
  type PlayerEvent,
} from '@babel/contracts'

/** A private streaming connection backs the player's existing revocable socket. */
export function createSubtitleRelay(
  connectionId: string,
  emit: (event: PlayerEvent) => void,
) {
  let session: ListenerSnapshot | null = null
  let key = ''
  let epoch = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  let sourceGeneration = 0
  let attempts = 0

  function stop() {
    epoch += 1
    session = null
    key = ''
    clearTimeout(retry)
    controller?.abort()
    controller = undefined
  }
  function unavailable(target: ListenerSnapshot) {
    if (!target.outputLanguage) {
      return
    }
    emit({
      type: 'subtitles',
      subscriptionVersion: target.subscriptionVersion,
      outputLanguage: target.outputLanguage,
      event: {
        type: 'subtitle-state',
        roomId: target.roomId,
        sourceGeneration,
        speakerId: null,
        streamGeneration: 0,
        outputLanguage: target.outputLanguage,
        state: 'UNAVAILABLE',
        failure: 'UNAVAILABLE',
      },
    })
  }
  async function connect() {
    const target = session
    if (!target?.outputLanguage) {
      return
    }
    const active = ++epoch
    const cancellation = new AbortController()
    controller = cancellation
    let deadline = setTimeout(() => cancellation.abort(), 5_000)
    try {
      const config = useRuntimeConfig()
      if (!config.mediaControlUrl || !config.mediaControlSecret) {
        throw new Error('Unavailable')
      }
      const destination = new URL('/subtitles', config.mediaControlUrl)
      if (!['http:', 'https:'].includes(destination.protocol)) {
        throw new Error('Unavailable')
      }
      const response = await fetch(destination, {
        method: 'POST',
        redirect: 'error',
        signal: cancellation.signal,
        headers: {
          authorization: `Bearer ${config.mediaControlSecret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          connectionId,
          reference: {
            sessionId: target.sessionId,
            nicknameGeneration: target.nicknameGeneration,
          },
          subscriptionVersion: target.subscriptionVersion,
        }),
      })
      if (
        !response.ok ||
        !response.body ||
        !response.headers.get('content-type')?.startsWith('application/x-ndjson')
      ) {
        throw new Error('Unavailable')
      }
      attempts = 0
      const decoder = new TextDecoder()
      let pending = ''
      clearTimeout(deadline)
      deadline = setTimeout(() => cancellation.abort(), 25_000)
      for await (const chunk of response.body) {
        if (active !== epoch) {
          break
        }
        clearTimeout(deadline)
        deadline = setTimeout(() => cancellation.abort(), 25_000)
        pending += decoder.decode(chunk, { stream: true })
        let newline: number
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline)
          pending = pending.slice(newline + 1)
          if (!line) {
            continue
          }
          if (Buffer.byteLength(line) > 128 * 1024) {
            throw new Error('Frame too large')
          }
          const message = subtitleMessageSchema.parse(JSON.parse(line))
          const value = message.type === 'subtitle' ? message.value : message
          if (
            value.roomId !== target.roomId ||
            value.outputLanguage !== target.outputLanguage
          ) {
            throw new Error('Wrong subscription')
          }
          sourceGeneration = Math.max(sourceGeneration, value.sourceGeneration)
          emit({
            type: 'subtitles',
            subscriptionVersion: target.subscriptionVersion,
            outputLanguage: target.outputLanguage,
            event: message,
          })
        }
        if (Buffer.byteLength(pending) > 128 * 1024) {
          throw new Error('Frame too large')
        }
      }
    } catch {
      // Only a safe status reaches the player; no endpoints, credentials or upstream text.
    } finally {
      clearTimeout(deadline)
      cancellation.abort()
      if (active === epoch && session) {
        unavailable(target)
        retry = setTimeout(
          () => void connect(),
          Math.min(5_000, 250 * 2 ** Math.min(attempts++, 5)),
        )
        retry.unref()
      }
    }
  }
  return {
    update(next: ListenerSnapshot) {
      if (next.state !== 'ACTIVE' || !next.outputLanguage) {
        stop()
        return
      }
      const nextKey = `${next.sessionId}:${next.nicknameGeneration}:${next.subscriptionVersion}:${next.outputLanguage}`
      if (nextKey === key) {
        return
      }
      stop()
      session = next
      key = nextKey
      sourceGeneration = 0
      attempts = 0
      void connect()
    },
    stop,
  }
}
