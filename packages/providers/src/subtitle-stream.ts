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
import { openTranslation, translationLanguage } from './openai-translation.ts'
import { createPcm24k } from './resample.ts'
import { subtitleText } from './subtitle-text.ts'
import { recognitionTerminology } from './terminology.ts'
import { sourceLanguage } from './source-language.ts'
import type { TranslationPath, SubtitleUpdate } from './subtitle-work.ts'

export type SubtitleStreamEvent =
  | { type: 'subtitle'; value: SubtitleUpdate }
  | { type: 'reset'; outputLanguage: string; configurationVersion: number }
  | { type: 'failure'; code: Exclude<ProviderTestCode, 'PASS'> }
interface Subscriber {
  after: number
  sourceAfter: number
  window: string
  translationOffset: number
  sourceWindow: string | undefined
  sourceOffset: number
  receive: (event: SubtitleStreamEvent) => void
}
interface Output {
  path: TranslationPath
  stream: ReturnType<typeof openTranslation>
  subscribers: Set<Subscriber>
  value: SubtitleUpdate
  ready: boolean
  failed: boolean
  pending: string[]
  attempt: number
  retryAt: number | null
  displayWindow: string
  displaySequence: number
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

/** One original-text stream and one direct-audio translation per target language.
 * No translation waits for recognition, a complete utterance, or another target. */
export function openSharedSubtitleStream(input: {
  recognition: { settings: OpenAISettings; credential: string }
  sampleRate: 16_000 | 48_000
  terminology: TerminologySnapshot | null
  signal?: AbortSignal
}) {
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
    // Fence late deltas and handshake completion before closing the socket.
    outputs.delete(output.path.outputLanguage)
    output.pending = []
    output.retryAt = null
    output.stream.close()
  }
  function deliver(output: Output, event: SubtitleStreamEvent) {
    if (closed || outputs.get(output.path.outputLanguage) !== output) {
      return
    }
    for (const subscriber of output.subscribers) {
      if (events > subscriber.after) {
        try {
          if (event.type === 'subtitle') {
            const value = event.value
            const direct = value.sourceAlignment === 'aligned'
            const sourceText =
              sourceEvents > subscriber.sourceAfter
                ? direct && value.utteranceId === subscriber.sourceWindow
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
                  : value.utteranceId === subscriber.window &&
                      subscriber.translationOffset > 0
                    ? subtitleText(
                        output.path.outputLanguage,
                        output.value.translatedText.slice(subscriber.translationOffset),
                      )
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
  }
  function usesTranscript(output: Output) {
    return source?.language === translationLanguage(output.path.outputLanguage)
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
        ...(direct
          ? {
              translatedText: subtitleText(output.path.outputLanguage, direct.text),
              translationRevision: direct.revision,
              translationIsFinal: direct.isFinal,
              sourceAlignment: 'aligned',
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
  function laneFailure(output: Output, error: unknown) {
    if (closed || output.failed || outputs.get(output.path.outputLanguage) !== output) {
      return
    }
    output.failed = true
    output.stream.close()
    output.value.failure = error instanceof ProviderFailure ? error.code : 'UNAVAILABLE'
    output.pending = []
    if (
      !ending &&
      ['TIMEOUT', 'UNAVAILABLE', 'RATE_LIMITED'].includes(output.value.failure)
    ) {
      output.retryAt = Date.now() + Math.min(5000, 250 * 2 ** output.attempt)
    }
    events += 1
    if (!usesTranscript(output)) {
      deliver(output, { type: 'failure', code: output.value.failure })
    }
  }
  function makeOutput(
    path: TranslationPath,
    subscribers = new Set<Subscriber>(),
  ): Output {
    let output: Output
    const stream = openTranslation({
      ...path,
      signal: input.signal,
      delta(text) {
        if (
          closed ||
          output.failed ||
          !text ||
          outputs.get(output.path.outputLanguage) !== output
        ) {
          return
        }
        // These APIs do not provide cross-session utterance alignment. Keep a
        // bounded display window, label source text independently, and never
        // manufacture matching source timestamps or finality for translated text.
        const fragment =
          text.length > 2048 ? text.slice(-2048).replace(/^[\uDC00-\uDFFF]/u, '') : text
        if (fragment !== text) {
          output.value.discontinuity = true
        }
        if (
          output.value.translatedText.length + fragment.length > 2048 ||
          (Boolean(fragment.trim()) &&
            /[.!?。！？]\s*$/u.test(output.value.translatedText))
        ) {
          output.value = {
            ...output.value,
            utteranceId: randomUUID(),
            sequence: output.value.sequence + 1,
            translatedText: '',
            translationRevision: 0,
          }
        }
        output.value.translatedText += fragment
        output.value.translationRevision += 1
        if (!usesTranscript(output)) {
          publish(output)
        }
      },
    })
    output = {
      path,
      subscribers,
      ready: false,
      failed: false,
      stream,
      pending: [],
      attempt: 0,
      retryAt: null,
      displayWindow: '',
      displaySequence: 0,
      value: {
        utteranceId: randomUUID(),
        revision: 1,
        text: source?.text ?? '',
        language: 'und',
        isFinal: source?.isFinal ?? false,
        audioStartMs: null,
        audioEndMs: null,
        sourceAlignment: 'independent',
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
    void output.stream.ready
      .then(() => {
        if (outputs.get(path.outputLanguage) !== output || output.failed || closed) {
          return
        }
        output.ready = true
        for (const audio of output.pending) {
          output.stream.append(audio)
        }
        output.pending = []
      })
      .catch((error: unknown) => laneFailure(output, error))
    void output.stream.finished
      .then(() => {
        if (ending && !closed) {
          output.value.translationIsFinal = true
          if (!usesTranscript(output)) {
            publish(output)
          }
        }
      })
      .catch((error: unknown) => laneFailure(output, error))
    return output
  }
  function cleanup() {
    closed = true
    clearInterval(sweep)
    input.signal?.removeEventListener('abort', abort)
    recognition.close()
    sourcePending = []
    for (const output of outputs.values()) {
      output.stream.close()
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
    context: recognitionTerminology(input.terminology?.terms ?? []),
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
        if (previous?.language === target && language !== target) {
          // Do not revive the translation window accumulated during direct output.
          output.value.utteranceId = randomUUID()
          output.value.translatedText = ''
          output.value.translationRevision = 0
          output.value.translationIsFinal = false
        }
        output.value.text = value.text
        output.value.language = language
        output.value.isFinal = value.isFinal
        output.value.revision += 1
        publish(output)
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
    for (const [code, output] of outputs) {
      if (
        !ending &&
        output.subscribers.size &&
        output.retryAt !== null &&
        output.retryAt <= now
      ) {
        const replacement = makeOutput(output.path, output.subscribers)
        replacement.displaySequence = output.displaySequence
        replacement.attempt = output.attempt + 1
        replacement.value.sequence = output.value.sequence + 1
        replacement.value.discontinuity = true
        outputs.set(code, replacement)
        events += 1
        if (!usesTranscript(replacement)) {
          deliver(replacement, {
            type: 'reset',
            outputLanguage: code,
            configurationVersion: output.path.version,
          })
        }
        continue
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
  // Whichever session is ready first can consume current audio. Recognition
  // and targets never wait for one another; connecting lanes retain <=100 ms.
  const ready = Promise.resolve().then(() =>
    Promise.any([
      recognition.ready,
      ...[...outputs.values()].map((output) => output.stream.ready),
    ]),
  )
  void ready.catch(() => {})
  function replaceOutput(path: TranslationPath) {
    const value = checked(path)
    const previous = outputs.get(value.outputLanguage)
    if (closed || ending || !previous || value.version <= previous.path.version) {
      throw new ProviderFailure('INVALID_CONFIGURATION')
    }
    previous.stream.close()
    for (const subscriber of previous.subscribers) {
      subscriber.after = events
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
    ready,
    async prepare() {
      // Finite uploaded samples wait for their selected target before playback.
      await Promise.all([
        recognition.ready,
        ...[...outputs.values()].map((output) => output.stream.ready),
      ])
    },
    finished: completed.promise,
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
      const subscriber = {
        after: events,
        sourceAfter: sourceEvents,
        window: output.value.utteranceId,
        translationOffset: output.value.translatedText.length,
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
      for (const output of outputs.values()) {
        if (!output.failed && output.subscribers.size) {
          try {
            if (output.ready) {
              output.stream.append(frame.audio)
            } else {
              if (output.pending.length >= 5) {
                output.pending.shift()
                output.value.discontinuity = true
              }
              output.pending.push(frame.audio)
            }
          } catch (error) {
            laneFailure(output, error)
          }
        }
      }
    },
    end() {
      if (!ending && !closed) {
        ending = true
        void Promise.all([
          recognition.end(),
          ...[...outputs.values()].map((output) => output.stream.end()),
        ])
          .then(() => {
            if (!closed) {
              const duration = (samples / input.sampleRate) * 1000
              cleanup()
              completed.resolve({ processedAudioMs: duration, sentAudioMs: duration })
            }
          })
          .catch((error: unknown) =>
            fail(
              error instanceof ProviderFailure
                ? error
                : new ProviderFailure('UNAVAILABLE'),
            ),
          )
      }
      return completed.promise
    },
    close() {
      fail(new ProviderFailure('UNAVAILABLE'))
    },
  }
}
