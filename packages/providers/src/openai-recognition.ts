import { randomUUID } from 'node:crypto'
import type { OpenAISettings, Transcript } from '@babel/contracts'
import { ProviderFailure } from './errors.ts'
import { openOpenAISession } from './openai-session.ts'
import type { RecognitionContext } from './terminology.ts'

export function openRecognition(input: {
  settings: OpenAISettings
  credential: string
  context?: RecognitionContext
  signal?: AbortSignal
  onTranscript: (value: Transcript) => void
}) {
  const items = new Map<string, Transcript>()
  let ending = false
  let bufferedMs = 0
  let silentMs = 0
  let speaking = false
  let commits = 0
  let completed = 0
  let order = 0
  let latest = 0
  let publishedItem: string | undefined
  const orders = new Map<string, number>()
  const session = openOpenAISession({
    ...input,
    translation: false,
    configuration: {
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: {
            model: 'gpt-live-transcribe',
            delay: 'minimal',
            ...input.context,
          },
          turn_detection: null,
        },
      },
    },
    event(event) {
      if (
        event.type === 'input_audio_buffer.committed' &&
        typeof event.item_id === 'string' &&
        !orders.has(event.item_id)
      ) {
        orders.set(event.item_id, ++order)
        if (orders.size > 512) {
          const oldest = orders.keys().next().value
          if (oldest) {
            orders.delete(oldest)
          }
        }
      }
      const final =
        event.type === 'conversation.item.input_audio_transcription.completed'
      if (
        !final &&
        event.type !== 'conversation.item.input_audio_transcription.delta'
      ) {
        return
      }
      if (
        typeof event.item_id !== 'string' ||
        typeof (final ? event.transcript : event.delta) !== 'string'
      ) {
        throw new ProviderFailure('INVALID_RESPONSE')
      }
      let item = items.get(event.item_id)
      if (!item) {
        if (items.size >= 32) {
          const oldest = items.keys().next().value
          if (oldest) {
            items.delete(oldest)
          }
        }
        item = {
          utteranceId: randomUUID(),
          revision: 0,
          text: '',
          language: 'und',
          sourceAlignment: 'independent',
          isFinal: false,
          audioStartMs: null,
          audioEndMs: null,
        }
      }
      if (item.isFinal) {
        return
      }
      item = {
        ...item,
        revision: item.revision + 1,
        text: final ? String(event.transcript) : item.text + String(event.delta),
        isFinal: final,
      }
      if (item.text.length > 4096) {
        throw new ProviderFailure('INVALID_RESPONSE')
      }
      items.set(event.item_id, item)
      if (!orders.has(event.item_id)) {
        orders.set(event.item_id, ++order)
      }
      const rank = orders.get(event.item_id) ?? 0
      if (rank >= latest) {
        latest = rank
        if (item.text.trim() || publishedItem === event.item_id) {
          publishedItem = event.item_id
          input.onTranscript(item)
        }
      }
      if (final) {
        completed += 1
        if (ending && completed >= commits) {
          session.complete()
        }
      }
    },
  })
  function commit() {
    if (bufferedMs >= 100) {
      commits += 1
      session.send({ type: 'input_audio_buffer.commit' })
      bufferedMs = 0
      speaking = false
      silentMs = 0
    }
  }
  return {
    ready: session.ready,
    finished: session.finished,
    append(audio: string, durationMs: number, speech: boolean) {
      session.send({ type: 'input_audio_buffer.append', audio })
      bufferedMs += durationMs
      if (speech) {
        speaking = true
        silentMs = 0
      } else {
        silentMs += durationMs
      }
      // Local endpointing finalizes source text only; translation never waits.
      if ((speaking && silentMs >= 120) || bufferedMs >= 5000) {
        commit()
      }
    },
    async end() {
      ending = true
      if (bufferedMs > 0 && bufferedMs < 100) {
        const padding = 100 - bufferedMs
        session.send({
          type: 'input_audio_buffer.append',
          audio: Buffer.alloc(Math.ceil(padding * 24) * 2).toString('base64'),
        })
        bufferedMs = 100
      }
      commit()
      if (completed >= commits) {
        session.complete()
      }
      await session.awaitCompletion()
    },
    close: session.close,
  }
}
