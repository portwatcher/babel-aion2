import { randomUUID } from 'node:crypto'
import type { SubtitleLatency } from '@babel/contracts'
import {
  babelMeter,
  babelTracer,
  parentContext,
  spanContext,
  subtitleLatencyBuckets,
  type Span,
} from '@babel/telemetry'

const PROBE_LIMIT = 32
const PROBE_TTL_MS = 30_000

interface Probe {
  relay: Span
  latency: SubtitleLatency
  sentAt: number
  outputLanguage: string
}

let instruments: {
  meter: ReturnType<typeof babelMeter>
  visible: ReturnType<ReturnType<typeof babelMeter>['createHistogram']>
} | null = null
function visibleHistogram() {
  const meter = babelMeter()
  if (instruments?.meter !== meter) {
    instruments = {
      meter,
      visible: meter.createHistogram('babel.subtitle.visible_latency', {
        description: 'Worker receipt of speech onset to the rendered browser subtitle',
        unit: 'ms',
        advice: { explicitBucketBoundaries: subtitleLatencyBuckets },
      }),
    }
  }
  return instruments.visible
}

/** Browser clocks are untrusted, so display time is the server send time plus
 * half the measured heartbeat round trip plus the browser-measured render delay. */
export function estimateDisplayedAt(input: {
  sentAt: number
  reportedAt: number
  renderDelayMs: number
  rttMs: number | null
}) {
  const transit =
    input.rttMs === null
      ? Math.max(0, (input.reportedAt - input.sentAt - input.renderDelayMs) / 2)
      : input.rttMs / 2
  return {
    transitMs: transit,
    displayedAt: Math.min(
      input.reportedAt,
      Math.max(input.sentAt, input.sentAt + transit + input.renderDelayMs),
    ),
  }
}

/** Latency probes for one player socket; bounded and short-lived. */
export class SubtitleLatencyProbes {
  private readonly probes = new Map<string, Probe>()

  /** Relays one marked subtitle; `send` performs the actual socket write. */
  relay(
    latency: SubtitleLatency,
    outputLanguage: string,
    receivedAt: number,
    send: (probe: string) => void,
  ) {
    const relay = babelTracer().startSpan(
      'babel.subtitle.web_relay',
      {
        startTime: receivedAt,
        attributes: { 'babel.output_language': outputLanguage },
      },
      parentContext(latency.traceparent),
    )
    this.expire(receivedAt)
    const probe = randomUUID()
    send(probe)
    const sentAt = Date.now()
    relay.end(sentAt)
    this.probes.set(probe, {
      relay,
      latency,
      sentAt,
      outputLanguage,
    })
    while (this.probes.size > PROBE_LIMIT) {
      const oldest = this.probes.keys().next().value
      if (oldest) {
        this.probes.delete(oldest)
      }
    }
  }

  /** Returns whether the probe was known; unknown or late reports are ignored. */
  displayed(
    probe: string,
    renderDelayMs: number,
    visible: boolean,
    rttMs: number | null,
    reportedAt = Date.now(),
  ) {
    const value = this.probes.get(probe)
    this.probes.delete(probe)
    if (!value || reportedAt - value.sentAt > PROBE_TTL_MS) {
      return false
    }
    const { transitMs, displayedAt } = estimateDisplayedAt({
      sentAt: value.sentAt,
      reportedAt,
      renderDelayMs,
      rttMs,
    })
    const attributes = {
      'babel.output_language': value.outputLanguage,
      'babel.player.visible': visible,
      'babel.subtitle.attribution': value.latency.attribution,
    }
    const parent = spanContext(value.relay)
    const tracer = babelTracer()
    tracer
      .startSpan(
        'babel.subtitle.player_transit',
        {
          startTime: value.sentAt,
          attributes: {
            ...attributes,
            'babel.player.rtt_ms': rttMs ?? -1,
          },
        },
        parent,
      )
      .end(Math.min(displayedAt, value.sentAt + transitMs))
    tracer
      .startSpan(
        'babel.subtitle.browser_render',
        {
          startTime: Math.max(value.sentAt, displayedAt - renderDelayMs),
          attributes,
        },
        parent,
      )
      .end(displayedAt)
    visibleHistogram().record(displayedAt - value.latency.speechStartedAt, attributes)
    return true
  }

  private expire(now: number) {
    for (const [probe, value] of this.probes) {
      if (now - value.sentAt <= PROBE_TTL_MS) {
        break
      }
      this.probes.delete(probe)
    }
  }

  clear() {
    this.probes.clear()
  }
}
