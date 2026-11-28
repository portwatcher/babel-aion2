import { randomUUID } from 'node:crypto'
import {
  openaiSettingsSchema,
  providerCredentialSchema,
  type OpenAISettings,
  type ProviderTestCode,
  type TerminologySnapshot,
  type Transcript,
} from '@babel/contracts'
import { ProviderFailure } from './errors.ts'
import { openRecognition } from './openai-recognition.ts'
import { translationLanguage } from './openai-translation.ts'
import { createPcm24k } from './resample.ts'
import { subtitleText } from './subtitle-text.ts'
import { recognitionTerminology, translationTerminology } from './terminology.ts'
import { createTranslationLane } from './translation-lane.ts'
import { sourceLanguage } from './source-language.ts'
import type { TranslationPath, SubtitleUpdate } from './subtitle-work.ts'

export type SubtitleStreamEvent =
  | { type: 'subtitle'; value: SubtitleUpdate }
  | { type: 'reset'; outputLanguage: string; configurationVersion: number }
  | { type: 'failure'; code: Exclude<ProviderTestCode, 'PASS'> }

interface Subscriber {
  after: number
  sourceAfter: number
  sourceWindow: string | undefined
  sourceOffset: number
  receive: (event: SubtitleStreamEvent) => void
}

interface Output {
  path: TranslationPath
  subscribers: Set<Subscriber>
  value: SubtitleUpdate
  displayWindow: string
  displaySequence: number
  lane: ReturnType<typeof createTranslationLane>
}

function checked(path: TranslationPath) {
  translationLanguage(path.outputLanguage)
  if (
    !openaiSettingsSchema.safeParse(path.settings).success ||
    !providerCredentialSchema.safeParse(path.credential).success ||
    !Number.isSafeInteger(path.version) ||
    path.version < 1
  ) {
    throw new ProviderFailure('INVALID_CONFIGURATION')
  }
  return path
}

/** One shared VAD-gated recognition stream and lightweight streaming text
 * translation per subscribed target language. */
export function openSharedSubtitleStream(input: {
  recognition: { settings: OpenAISettings; credential: string }
  sampleRate: 16_000 | 48_000
  terminology: TerminologySnapshot | null
  signal?: AbortSignal
}) {
  const recognitionContext = recognitionTerminology(input.terminology?.terms ?? [])
  const outputs = new Map<string, Output>()
  const completed = Promise.withResolvers<{
    processedAudioMs: number
    sentAudioMs: number
  }>()
  void completed.promise.catch(() => {})
  const convert = createPcm24k(input.sampleRate)
  let closed = false
  let ending = false
  let samples = 0
  let events = 0
  let sourceEvents = 0
  let source: Transcript | undefined
  let failure: ProviderFailure | undefined
  let recognitionReady = false
  let sourcePending: Array<ReturnType<typeof convert>> = []
  const created = Date.now()

  function releaseUnused(output: Output) {
    if (output.subscribers.size || outputs.get(output.path.outputLanguage) !== output) {
      return
    }
    outputs.delete(output.path.outputLanguage)
    output.lane.close()
  }

  function usesTranscript(output: Output) {
    return source?.language === translationLanguage(output.path.outputLanguage)
  }

  function deliver(output: Output, event: SubtitleStreamEvent) {
    if (closed || outputs.get(output.path.outputLanguage) !== output) {
      return
    }
    const direct = usesTranscript(output)
    for (const subscriber of output.subscribers) {
      if (events <= subscriber.after) {
        continue
      }
      try {
        if (event.type === 'subtitle') {
          const value = event.value
          if (
            !direct &&
            value.utteranceId === subscriber.sourceWindow &&
            subscriber.sourceOffset > 0
          ) {
            // Never leak pre-subscription speech through a re-translated utterance.
            continue
          }
          const sourceText =
            sourceEvents > subscriber.sourceAfter
              ? value.utteranceId === subscriber.sourceWindow
                ? value.text.slice(subscriber.sourceOffset)
                : value.text
              : ''
          subscriber.receive({
            type: 'subtitle',
            value: {
              ...value,
              text: sourceText,
              translatedText: direct
                ? sourceText === value.text
                  ? value.translatedText
                  : subtitleText(output.path.outputLanguage, sourceText)
                : value.translatedText,
            },
          })
        } else {
          subscriber.receive(event)
        }
      } catch {
        output.subscribers.delete(subscriber)
        releaseUnused(output)
      }
    }
  }

  function publish(output: Output) {
    events += 1
    const direct = usesTranscript(output) ? source : undefined
    const utteranceId = direct?.utteranceId ?? output.value.utteranceId
    if (output.displayWindow !== utteranceId) {
      output.displayWindow = utteranceId
      output.displaySequence += 1
    }
    deliver(output, {
      type: 'subtitle',
      value: {
        ...output.value,
        utteranceId,
        sequence: output.displaySequence,
        sourceAlignment: 'aligned',
        ...(direct
          ? {
              translatedText: subtitleText(output.path.outputLanguage, direct.text),
              translationRevision: direct.revision,
              translationIsFinal: direct.isFinal,
              translationTermCount: 0,
              failure: null,
            }
          : {
              translatedText: subtitleText(
                output.path.outputLanguage,
                output.value.translatedText,
              ),
            }),
      },
    })
  }

  function makeOutput(
    path: TranslationPath,
    subscribers = new Set<Subscriber>(),
  ): Output {
    const glossary = translationTerminology(
      input.terminology?.terms ?? [],
      path.outputLanguage,
    )
    let output: Output
    const lane = createTranslationLane({
      path,
      glossary,
      signal: input.signal,
      isActive: () =>
        !closed &&
        Boolean(output.subscribers.size) &&
        outputs.get(path.outputLanguage) === output,
      isDirect: () => usesTranscript(output),
      isEnding: () => ending,
      currentUtteranceId: () => output.value.utteranceId,
      onProgress(progress) {
        if (progress.text) {
          output.value.translatedText = progress.text
        }
        if (progress.discontinuity) {
          output.value.discontinuity = true
        }
        output.value.translationIsFinal = progress.isFinal
        output.value.translationTermCount = progress.termCount
        output.value.failure = null
        output.value.translationRevision += 1
        publish(output)
      },
      onFailure(code) {
        output.value.failure = code
        output.value.translatedText = ''
        output.value.translationIsFinal = false
        output.value.translationRevision += 1
        publish(output)
        events += 1
        deliver(output, { type: 'failure', code })
      },
      onReset() {
        output.value.failure = null
        output.value.discontinuity = true
        output.value.sequence += 1
        events += 1
        deliver(output, {
          type: 'reset',
          outputLanguage: path.outputLanguage,
          configurationVersion: path.version,
        })
      },
    })
    output = {
      path,
      subscribers,
      displayWindow: '',
      displaySequence: 0,
      lane,
      value: {
        utteranceId: source?.utteranceId ?? randomUUID(),
        revision: source?.revision ?? 1,
        text: source?.text ?? '',
        language: source?.language ?? 'und',
        isFinal: source?.isFinal ?? false,
        audioStartMs: null,
        audioEndMs: null,
        sourceAlignment: 'aligned',
        translatedText: '',
        translationRevision: 0,
        translationIsFinal: false,
        translationTermCount: 0,
        failure: null,
        outputLanguage: path.outputLanguage,
        configurationVersion: path.version,
        sequence: 1,
        discontinuity: false,
      },
    }
    return output
  }

  function cleanup() {
    closed = true
    clearInterval(sweep)
    input.signal?.removeEventListener('abort', abort)
    recognition.close()
    sourcePending = []
    for (const output of outputs.values()) {
      output.lane.close()
    }
    outputs.clear()
  }

  function fail(error: ProviderFailure) {
    if (closed) {
      return
    }
    failure = error
    events += 1
    for (const output of outputs.values()) {
      deliver(output, { type: 'failure', code: error.code })
    }
    cleanup()
    completed.reject(error)
  }

  function abort() {
    fail(new ProviderFailure('TIMEOUT'))
  }

  const recognition = openRecognition({
    ...input.recognition,
    signal: input.signal,
    context: recognitionContext,
    onTranscript(value) {
      if (closed) {
        return
      }
      const language =
        !value.text && source?.utteranceId === value.utteranceId
          ? source.language
          : sourceLanguage(value.text)
      const previous = source
      source = { ...value, language }
      sourceEvents += 1
      for (const output of outputs.values()) {
        const target = translationLanguage(output.path.outputLanguage)
        const utteranceChanged = output.value.utteranceId !== value.utteranceId
        if (
          utteranceChanged ||
          (previous?.language === target && language !== target)
        ) {
          output.lane.resetUtterance(false)
          output.value.utteranceId = value.utteranceId
          output.value.translatedText = ''
          output.value.translationRevision = 0
          output.value.translationIsFinal = false
          output.value.translationTermCount = 0
        }
        output.value.text = value.text
        output.value.language = language
        output.value.isFinal = value.isFinal
        output.value.revision = value.revision
        if (usesTranscript(output)) {
          output.lane.resetUtterance(false)
          publish(output)
          continue
        }
        if (!value.text.trim()) {
          output.lane.resetUtterance(true)
          output.value.translatedText = ''
          output.value.translationRevision += 1
          output.value.translationIsFinal = value.isFinal
          output.value.translationTermCount = 0
          publish(output)
          continue
        }
        publish(output)
        const promotedFinal = output.lane.schedule(
          {
            utteranceId: value.utteranceId,
            text: value.text,
            isFinal: value.isFinal,
          },
          output.value.translationIsFinal,
        )
        if (promotedFinal) {
          output.value.translationIsFinal = true
          output.value.translationRevision += 1
          publish(output)
        }
      }
    },
  })

  void recognition.ready
    .then(() => {
      if (closed) {
        return
      }
      recognitionReady = true
      for (const frame of sourcePending) {
        recognition.append(frame.audio, frame.durationMs, frame.speech)
      }
      sourcePending = []
    })
    .catch((error: unknown) =>
      fail(
        error instanceof ProviderFailure ? error : new ProviderFailure('UNAVAILABLE'),
      ),
    )

  void recognition.finished.catch((error: unknown) =>
    fail(error instanceof ProviderFailure ? error : new ProviderFailure('UNAVAILABLE')),
  )

  const sweep = setInterval(() => {
    const now = Date.now()
    for (const output of outputs.values()) {
      if (!ending && output.subscribers.size) {
        output.lane.pollRetry(now)
      }
    }
    if (!outputs.size && !ending && now - created >= 2000) {
      fail(new ProviderFailure('UNAVAILABLE'))
    }
  }, 250)
  sweep.unref()

  input.signal?.addEventListener('abort', abort, { once: true })
  if (input.signal?.aborted) {
    abort()
  }

  function replaceOutput(path: TranslationPath) {
    const value = checked(path)
    const previous = outputs.get(value.outputLanguage)
    if (closed || ending || !previous || value.version <= previous.path.version) {
      throw new ProviderFailure('INVALID_CONFIGURATION')
    }
    previous.lane.close()
    for (const subscriber of previous.subscribers) {
      subscriber.after = events
      subscriber.sourceAfter = sourceEvents
      subscriber.sourceWindow = source?.utteranceId
      subscriber.sourceOffset = source?.text.length ?? 0
    }
    const output = makeOutput(value, previous.subscribers)
    output.displaySequence = previous.displaySequence
    outputs.set(value.outputLanguage, output)
    events += 1
    deliver(output, {
      type: 'reset',
      outputLanguage: value.outputLanguage,
      configurationVersion: value.version,
    })
  }

  return {
    ready: recognition.ready,
    async prepare() {
      await recognition.ready
    },
    finished: completed.promise,
    sentAudioMs() {
      return recognition.sentAudioMs()
    },
    subscribe(path: TranslationPath, receive: Subscriber['receive']) {
      if (closed || ending) {
        throw new ProviderFailure('UNAVAILABLE')
      }
      const value = checked(path)
      let output = outputs.get(value.outputLanguage)
      if (output && JSON.stringify(output.path) !== JSON.stringify(value)) {
        replaceOutput(value)
        output = outputs.get(value.outputLanguage)
      }
      if (!output) {
        if (outputs.size >= 32) {
          throw new ProviderFailure('INVALID_CONFIGURATION')
        }
        output = makeOutput(value)
        outputs.set(value.outputLanguage, output)
      }
      const subscriber: Subscriber = {
        after: events,
        sourceAfter: sourceEvents,
        sourceWindow: source?.utteranceId,
        sourceOffset: source?.text.length ?? 0,
        receive,
      }
      output.subscribers.add(subscriber)
      return () => {
        const current = outputs.get(value.outputLanguage)
        current?.subscribers.delete(subscriber)
        if (current) {
          releaseUnused(current)
        }
      }
    },
    replaceOutput,
    write(pcm: Uint8Array, sampleOffset: number) {
      if (closed) {
        throw failure ?? new ProviderFailure('UNAVAILABLE')
      }
      if (
        ending ||
        sampleOffset !== samples ||
        !pcm.byteLength ||
        pcm.byteLength > (input.sampleRate / 50) * 2
      ) {
        throw new ProviderFailure('INVALID_CONFIGURATION')
      }
      const frame = convert(pcm)
      samples += pcm.byteLength / 2
      if (recognitionReady) {
        recognition.append(frame.audio, frame.durationMs, frame.speech)
      } else {
        if (sourcePending.length >= 5) {
          sourcePending.shift()
          for (const output of outputs.values()) {
            output.value.discontinuity = true
          }
        }
        sourcePending.push(frame)
      }
    },
    end() {
      if (!ending && !closed) {
        ending = true
        for (const output of outputs.values()) {
          output.lane.flushForEnd()
        }
        void (async () => {
          try {
            await recognition.end()
            await Promise.all(
              [...outputs.values()].map((output) => output.lane.waitIdle()),
            )
            if (!closed) {
              const duration = (samples / input.sampleRate) * 1000
              const sent = recognition.sentAudioMs()
              cleanup()
              completed.resolve({ processedAudioMs: duration, sentAudioMs: sent })
            }
          } catch (error) {
            fail(
              error instanceof ProviderFailure
                ? error
                : new ProviderFailure('UNAVAILABLE'),
            )
          }
        })()
      }
      return completed.promise
    },
    close() {
      fail(new ProviderFailure('UNAVAILABLE'))
    },
  }
}
