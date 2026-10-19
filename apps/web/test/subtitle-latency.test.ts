import assert from 'node:assert/strict'
import { test } from 'node:test'
import { trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { playerMessageSchema, subtitleLatencySchema } from '@babel/contracts'
import {
  estimateDisplayedAt,
  SubtitleLatencyProbes,
} from '../server/utils/subtitle-latency.ts'

const exporter = new InMemorySpanExporter()
trace.setGlobalTracerProvider(
  new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
)
const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
const latency = {
  traceparent: `00-${traceId}-00f067aa0ba902b7-01`,
  speechStartedAt: Date.now() - 2_000,
  attribution: 'clean' as const,
}

test('display time uses server send time, half the round trip and render delay', () => {
  assert.deepEqual(
    estimateDisplayedAt({
      sentAt: 1_000,
      reportedAt: 1_200,
      renderDelayMs: 16,
      rttMs: 80,
    }),
    { transitMs: 40, displayedAt: 1_056 },
  )
  // Without a heartbeat, half of the unexplained report delay is the transit.
  assert.deepEqual(
    estimateDisplayedAt({
      sentAt: 1_000,
      reportedAt: 1_116,
      renderDelayMs: 16,
      rttMs: null,
    }),
    { transitMs: 50, displayedAt: 1_066 },
  )
  // An estimate never exceeds the moment the server received the report.
  assert.equal(
    estimateDisplayedAt({
      sentAt: 1_000,
      reportedAt: 1_030,
      renderDelayMs: 16,
      rttMs: 200,
    }).displayedAt,
    1_030,
  )
})

test('a relayed probe continues the worker trace and is accepted once', () => {
  exporter.reset()
  const probes = new SubtitleLatencyProbes()
  let sent = ''
  probes.relay(latency, 'ja', Date.now() - 5, (probe) => {
    sent = probe
  })
  assert.match(sent, /^[0-9a-f-]{36}$/u)
  assert.equal(probes.displayed(crypto.randomUUID(), 10, true, 40), false)
  assert.equal(probes.displayed(sent, 12, true, 40), true)
  assert.equal(probes.displayed(sent, 12, true, 40), false, 'single use')

  const finished = exporter.getFinishedSpans()
  const relay = finished.find((span) => span.name === 'babel.subtitle.web_relay')
  assert.ok(relay)
  assert.equal(relay.spanContext().traceId, traceId)
  assert.equal(relay.parentSpanContext?.spanId, '00f067aa0ba902b7')
  for (const name of [
    'babel.subtitle.player_transit',
    'babel.subtitle.browser_render',
  ]) {
    const span = finished.find((candidate) => candidate.name === name)
    assert.equal(span?.parentSpanContext?.spanId, relay.spanContext().spanId, name)
  }
})

test('expired probes are ignored', () => {
  const probes = new SubtitleLatencyProbes()
  let sent = ''
  probes.relay(latency, 'ko', Date.now(), (probe) => {
    sent = probe
  })
  assert.equal(probes.displayed(sent, 10, true, 40, Date.now() + 31_000), false)
})

test('browser reports carry only a probe and render timing', () => {
  const report = {
    type: 'subtitle-displayed',
    probe: crypto.randomUUID(),
    renderDelayMs: 14.5,
    visible: true,
  }
  assert.ok(playerMessageSchema.safeParse(report).success)
  assert.ok(!playerMessageSchema.safeParse({ ...report, displayedAt: 1 }).success)
  assert.ok(!playerMessageSchema.safeParse({ ...report, renderDelayMs: -1 }).success)
  assert.ok(!subtitleLatencySchema.safeParse({ ...latency, traceparent: 'x' }).success)
})
