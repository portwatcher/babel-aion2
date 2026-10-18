import {
  deeplSettingsSchema,
  languageCodeSchema,
  providerCredentialSchema,
  type ProviderTestCode,
  type SonioxSettings,
  type TerminologySnapshot,
} from '@babel/contracts'
import { ProviderFailure } from './errors.ts'
import { openSonioxStream } from './soniox-stream.ts'
import { recognitionTerminology } from './terminology.ts'
import {
  TranslationLane,
  type SubtitleUpdate,
  type TranslationPath,
} from './subtitle-work.ts'

export type SubtitleStreamEvent =
  | { type: 'subtitle'; value: SubtitleUpdate }
  | { type: 'reset'; outputLanguage: string; configurationVersion: number }
  | { type: 'failure'; code: Exclude<ProviderTestCode, 'PASS'> }
interface Subscriber {
  after: number
  receive: (event: SubtitleStreamEvent) => void
}
interface Output {
  lane: TranslationLane
  subscribers: Set<Subscriber>
  releaseAt: number | null
}
function checked(path: TranslationPath) {
  const settings = deeplSettingsSchema.safeParse(path.settings)
  if (
    !languageCodeSchema.safeParse(path.outputLanguage).success ||
    !settings.success ||
    !providerCredentialSchema.safeParse(path.credential).success ||
    !Number.isSafeInteger(path.version) ||
    path.version < 1
  ) {
    throw new ProviderFailure('INVALID_CONFIGURATION')
  }
  return {
    outputLanguage: path.outputLanguage,
    settings: settings.data,
    credential: path.credential,
    version: path.version,
  }
}

// A server-side owner creates one stream per commander/source generation and
// feeds decoded PCM once. Subscribers of the same language share one lane.
export function openSharedSubtitleStream(input: {
  recognition: { settings: SonioxSettings; credential: string }
  sampleRate: 16_000 | 48_000
  terminology: TerminologySnapshot | null
  signal?: AbortSignal
}) {
  const terminology = input.terminology ? structuredClone(input.terminology) : null
  const context = recognitionTerminology(terminology?.terms ?? [])
  const outputs = new Map<string, Output>()
  const completed = Promise.withResolvers<{
    processedAudioMs: number
    sentAudioMs: number
  }>()
  void completed.promise.catch(() => {})
  let closed = false
  let ending = false
  let failure: ProviderFailure | undefined
  let eventSequence = 0
  let utteranceId = ''
  let sequence = 0
  const created = Date.now()

  function deliver(output: Output, event: SubtitleStreamEvent, eventId = Infinity) {
    if (closed) {
      return
    }
    for (const subscriber of output.subscribers) {
      if (eventId > subscriber.after) {
        try {
          subscriber.receive(event)
        } catch {
          fail(new ProviderFailure('INVALID_RESPONSE'))
          return
        }
      }
    }
  }
  function makeOutput(
    path: TranslationPath,
    subscribers = new Set<Subscriber>(),
  ): Output {
    const output: Output = {
      subscribers,
      releaseAt: null,
      lane: new TranslationLane(path, terminology, (value, eventId) => {
        deliver(output, { type: 'subtitle', value }, eventId)
      }),
    }
    return output
  }
  function cleanup() {
    closed = true
    clearInterval(sweep)
    input.signal?.removeEventListener('abort', abort)
    for (const output of outputs.values()) {
      output.lane.close()
    }
    outputs.clear()
  }
  function fail(error: ProviderFailure) {
    if (closed || failure) {
      return
    }
    failure = error
    for (const output of outputs.values()) {
      deliver(output, { type: 'failure', code: error.code })
    }
    cleanup()
    recognition.close()
    completed.reject(error)
  }
  function abort() {
    fail(new ProviderFailure('TIMEOUT'))
  }

  const recognition = openSonioxStream(
    input.recognition.settings,
    input.recognition.credential,
    {
      sampleRate: input.sampleRate,
      signal: input.signal,
      context,
      onTranscript(transcript) {
        if (closed) {
          return
        }
        eventSequence += 1
        if (utteranceId !== transcript.utteranceId) {
          utteranceId = transcript.utteranceId
          sequence += 1
        }
        for (const output of outputs.values()) {
          if (output.subscribers.size) {
            output.lane.accept(transcript, sequence, eventSequence)
          }
        }
      },
    },
  )
  // Periodic reconciliation also releases a lane if an earlier unsubscribe
  // notification's deadline was delayed. No historical results are replayed.
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [code, output] of outputs) {
      if (
        !output.subscribers.size &&
        output.releaseAt !== null &&
        output.releaseAt <= now
      ) {
        output.lane.close()
        outputs.delete(code)
      }
    }
    if (!outputs.size && !ending && now - created >= 2_000) {
      fail(new ProviderFailure('UNAVAILABLE'))
    }
  }, 1_000)
  sweep.unref()
  // Recognition may finish before translation drains. Keep the owner's total
  // deadline attached until all work finishes, not just until the socket closes.
  input.signal?.addEventListener('abort', abort, { once: true })
  if (input.signal?.aborted) {
    abort()
  }
  void recognition.finished
    .then(async (result) => {
      await Promise.all([...outputs.values()].map((output) => output.lane.drain()))
      if (!closed) {
        cleanup()
        completed.resolve(result)
      }
    })
    .catch((error: unknown) => {
      fail(
        error instanceof ProviderFailure ? error : new ProviderFailure('UNAVAILABLE'),
      )
    })

  return {
    ready: recognition.ready,
    finished: completed.promise,
    subscribe(path: TranslationPath, receive: Subscriber['receive']) {
      if (closed || ending) {
        throw new ProviderFailure('UNAVAILABLE')
      }
      const value = checked(path)
      let output = outputs.get(value.outputLanguage)
      if (output && JSON.stringify(output.lane.path) !== JSON.stringify(value)) {
        throw new ProviderFailure('INVALID_CONFIGURATION')
      }
      if (!output) {
        if (outputs.size >= 32) {
          throw new ProviderFailure('INVALID_CONFIGURATION')
        }
        output = makeOutput(value)
        outputs.set(value.outputLanguage, output)
      }
      const subscriber = { after: eventSequence, receive }
      output.subscribers.add(subscriber)
      output.releaseAt = null
      return () => {
        // A path replacement retains this subscriber set.
        const current = outputs.get(value.outputLanguage)
        current?.subscribers.delete(subscriber)
        if (current && !current.subscribers.size && current.releaseAt === null) {
          current.releaseAt = Date.now() + 2_000
        }
      }
    },
    replaceOutput(path: TranslationPath) {
      if (closed || ending) {
        throw new ProviderFailure('UNAVAILABLE')
      }
      const value = checked(path)
      const previous = outputs.get(value.outputLanguage)
      if (!previous || value.version <= previous.lane.path.version) {
        throw new ProviderFailure('INVALID_CONFIGURATION')
      }
      previous.lane.close()
      for (const subscriber of previous.subscribers) {
        subscriber.after = eventSequence
      }
      const output = makeOutput(value, previous.subscribers)
      output.releaseAt = previous.releaseAt
      outputs.set(value.outputLanguage, output)
      deliver(output, {
        type: 'reset',
        outputLanguage: value.outputLanguage,
        configurationVersion: value.version,
      })
    },
    write(pcm: Uint8Array, sampleOffset: number) {
      if (closed) {
        throw failure ?? new ProviderFailure('UNAVAILABLE')
      }
      // No translation promise is awaited on this audio path.
      recognition.write(pcm, sampleOffset)
    },
    end() {
      ending = true
      void recognition.end().catch(() => {})
      return completed.promise
    },
    close() {
      fail(new ProviderFailure('UNAVAILABLE'))
    },
  }
}
