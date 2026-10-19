import type { SubtitleLatency } from '@babel/contracts'
import {
  babelMeter,
  babelTracer,
  subtitleLatencyBuckets,
  spanContext,
  traceparent,
  type Span,
} from '@babel/telemetry'

/** Int16 peak treated as speech; Discord also sends decoded near-silence frames. */
const VOICE_PEAK = 600
/** Speech after this much silence starts a new measured turn. */
export const TURN_GAP_MS = 800
/** A first translation this soon after the previous one may be a prior turn's tail. */
export const CLEAN_GAP_MS = 1_500

interface Turn {
  span: Span
  startedAt: number
  lastVoiceAt: number
  claimed: Set<string>
}

let instruments: {
  meter: ReturnType<typeof babelMeter>
  latency: ReturnType<ReturnType<typeof babelMeter>['createHistogram']>
} | null = null
function translationHistogram() {
  const meter = babelMeter()
  if (instruments?.meter !== meter) {
    instruments = {
      meter,
      latency: meter.createHistogram('babel.subtitle.translation_latency', {
        description: 'Worker receipt of speech onset to first translated fragment',
        unit: 'ms',
        advice: { explicitBucketBoundaries: subtitleLatencyBuckets },
      }),
    }
  }
  return instruments.latency
}

export function voiced(pcm: Buffer) {
  for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
    if (Math.abs(pcm.readInt16LE(offset)) >= VOICE_PEAK) {
      return true
    }
  }
  return false
}

/** Speech onsets for one speaker stream. The provider gives no utterance
 * alignment, so a turn's first fragment per language is the latency sample. */
export class SpeechTurns {
  private turn: Turn | null = null
  private readonly lastDelta = new Map<string, { at: number; revision: string }>()
  // Subscribers of one fan-out share a marker; cleared before the next task.
  private readonly current = new Map<
    string,
    { revision: string; marker: SubtitleLatency | undefined }
  >()

  constructor(private readonly roomId: string) {}

  hear(pcm: Buffer, now = Date.now()) {
    if (!voiced(pcm)) {
      return
    }
    if (this.turn && now - this.turn.lastVoiceAt < TURN_GAP_MS) {
      this.turn.lastVoiceAt = now
      return
    }
    this.end()
    this.turn = {
      span: babelTracer().startSpan('babel.speech.turn', {
        startTime: now,
        root: true,
        attributes: { 'babel.room_id': this.roomId },
      }),
      startedAt: now,
      lastVoiceAt: now,
      claimed: new Set(),
    }
  }

  /** Called for every subscriber of one update; all receive the same marker.
   * Only a new translated revision counts; original-text updates do not. */
  fragment(outputLanguage: string, revision: string | null, now = Date.now()) {
    const shared = this.current.get(outputLanguage)
    if (shared && shared.revision === revision) {
      return shared.marker
    }
    const previous = this.lastDelta.get(outputLanguage)
    if (!revision || previous?.revision === revision) {
      return undefined
    }
    this.lastDelta.set(outputLanguage, { at: now, revision })
    const marker = this.claim(outputLanguage, now, previous?.at)
    const entry = { revision, marker }
    this.current.set(outputLanguage, entry)
    queueMicrotask(() => {
      if (this.current.get(outputLanguage) === entry) {
        this.current.delete(outputLanguage)
      }
    })
    return marker
  }

  private claim(outputLanguage: string, now: number, previous: number | undefined) {
    const turn = this.turn
    if (!turn || turn.claimed.has(outputLanguage)) {
      return undefined
    }
    turn.claimed.add(outputLanguage)
    const attribution: SubtitleLatency['attribution'] =
      previous !== undefined && now - previous < CLEAN_GAP_MS ? 'overlapped' : 'clean'
    const attributes = {
      'babel.output_language': outputLanguage,
      'babel.subtitle.attribution': attribution,
    }
    translationHistogram().record(now - turn.startedAt, attributes)
    const span = babelTracer().startSpan(
      'babel.subtitle.translation',
      { startTime: turn.startedAt, attributes },
      spanContext(turn.span),
    )
    span.end(now)
    const value = traceparent(span)
    return value
      ? { traceparent: value, speechStartedAt: turn.startedAt, attribution }
      : undefined
  }

  private end() {
    this.turn?.span.end(this.turn.lastVoiceAt)
    this.turn = null
  }

  close() {
    this.end()
    this.current.clear()
  }
}
