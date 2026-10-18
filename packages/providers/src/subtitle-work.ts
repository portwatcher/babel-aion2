import type {
  DeepLSettings,
  ProviderTestCode,
  SampleSegment,
  TerminologySnapshot,
  Transcript,
} from '@babel/contracts'
import { translateDeepL } from './deepl.ts'
import { ProviderFailure } from './errors.ts'
import { translationTerminology } from './terminology.ts'

export interface TranslationPath {
  outputLanguage: string
  settings: DeepLSettings
  credential: string
  // The owner advances this version when the selected processing path changes.
  version: number
}
export interface SubtitleUpdate extends SampleSegment {
  outputLanguage: string
  configurationVersion: number
  // Order of utterances within this recognition stream, not arrival order of
  // translations. A delayed earlier utterance must not become the current one.
  sequence: number
  discontinuity: boolean
}
interface Work {
  transcript: Transcript
  sequence: number
  eventSequence: number
  signature: string
  due: number
  result: string
  revision: number
  termCount: number
  failure: Exclude<ProviderTestCode, 'PASS'> | null
  discontinuity: boolean
  translated: boolean
}

// One lane serves all subscribers of a source/output-language pair. Its network
// request never runs in the audio write call, and another lane cannot block it.
export class TranslationLane {
  private readonly records = new Map<string, Work>()
  private readonly pending = new Map<string, Work>()
  private readonly waiters = new Set<() => void>()
  private active: { work: Work; cancellation: AbortController } | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private lastStarted = -Infinity
  private closed = false

  constructor(
    readonly path: TranslationPath,
    private readonly terminology: TerminologySnapshot | null,
    private readonly emit: (value: SubtitleUpdate, eventSequence: number) => void,
  ) {}

  private publish(work: Work) {
    if (!this.closed) {
      this.emit(
        {
          ...work.transcript,
          outputLanguage: this.path.outputLanguage,
          configurationVersion: this.path.version,
          sequence: work.sequence,
          translatedText: work.result,
          translationRevision: work.revision,
          translationIsFinal: work.translated && work.transcript.isFinal,
          translationTermCount: work.termCount,
          failure: work.failure,
          discontinuity: work.discontinuity,
        },
        work.eventSequence,
      )
    }
  }

  accept(transcript: Transcript, sequence: number, eventSequence: number) {
    if (this.closed) {
      return
    }
    let work = this.records.get(transcript.utteranceId)
    if (work && transcript.revision <= work.transcript.revision) {
      return
    }
    const signature = JSON.stringify([transcript.text, transcript.language])
    const changed = !work || work.signature !== signature
    let overflow = false
    if (!work) {
      if (this.records.size >= 32) {
        const oldest = this.records.entries().next().value
        if (oldest) {
          const [id, previous] = oldest
          overflow = this.pending.delete(id) || this.active?.work === previous
          if (this.active?.work === previous) {
            this.active.cancellation.abort()
          }
          this.records.delete(id)
        }
      }
      work = {
        transcript,
        sequence,
        eventSequence,
        signature,
        due: Date.now() + 250,
        result: '',
        revision: 0,
        termCount: 0,
        failure: null,
        discontinuity: overflow,
        translated: false,
      }
      this.records.set(transcript.utteranceId, work)
    }
    work.transcript = transcript
    work.eventSequence = eventSequence
    if (changed) {
      work.signature = signature
      work.result = ''
      work.translated = false
      work.failure = null
      work.termCount = 0
      if (this.active?.work === work) {
        this.active.cancellation.abort()
      }
    }
    if (transcript.isFinal) {
      work.due = Date.now()
    }
    // Clear the previous revision immediately. Stable text whose only change
    // is finality can reuse its translation or its still-running request.
    this.publish(work)
    if (!transcript.text.trim()) {
      this.pending.delete(transcript.utteranceId)
      this.idle()
      return
    }
    if (changed || (!work.translated && !work.failure && this.active?.work !== work)) {
      this.pending.set(transcript.utteranceId, work)
    }
    this.schedule()
  }

  private idle() {
    if (!this.active && !this.pending.size && !this.timer) {
      for (const resolve of this.waiters) {
        resolve()
      }
      this.waiters.clear()
    }
  }

  private schedule() {
    if (this.closed || this.active || this.timer) {
      return
    }
    const work = this.pending.values().next().value
    if (!work) {
      this.idle()
      return
    }
    // Coalesce provisional revisions and bound request starts to four/second
    // per source/language. This is a processing guard, not a capacity claim.
    const delay = Math.max(work.due, this.lastStarted + 250) - Date.now()
    if (delay > 0) {
      this.timer = setTimeout(() => {
        this.timer = undefined
        this.schedule()
      }, delay)
      return
    }
    this.pending.delete(work.transcript.utteranceId)
    this.lastStarted = Date.now()
    const active = { work, cancellation: new AbortController() }
    this.active = active
    const signature = work.signature
    const transcript = work.transcript
    const current = () =>
      !this.closed &&
      !active.cancellation.signal.aborted &&
      this.records.get(transcript.utteranceId) === work &&
      work.signature === signature
    void (async () => {
      try {
        const terms = translationTerminology(
          this.terminology?.terms ?? [],
          transcript.language,
          this.path.outputLanguage,
        )
        const result = await translateDeepL(
          this.path.settings,
          this.path.credential,
          {
            text: transcript.text,
            sourceLanguage: transcript.language,
            outputLanguage: this.path.outputLanguage,
            context: terms.context,
          },
          active.cancellation.signal,
        )
        if (current()) {
          work.result = result
          work.revision += 1
          work.termCount = terms.count
          work.translated = true
          work.failure = null
          this.publish(work)
        }
      } catch (error) {
        if (current()) {
          work.failure = error instanceof ProviderFailure ? error.code : 'UNAVAILABLE'
          this.publish(work)
        }
      } finally {
        if (this.active === active) {
          this.active = undefined
        }
        this.schedule()
        this.idle()
      }
    })()
  }

  drain() {
    if (this.closed || (!this.active && !this.pending.size && !this.timer)) {
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => this.waiters.add(resolve))
  }

  close() {
    this.closed = true
    clearTimeout(this.timer)
    this.timer = undefined
    this.pending.clear()
    this.records.clear()
    this.active?.cancellation.abort()
    this.active = undefined
    this.idle()
  }
}
