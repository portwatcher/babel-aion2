import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:net'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import {
  babelTracer,
  startTelemetry,
  stopTelemetry,
  traceparent,
} from '../src/index.ts'

test('telemetry stays off without an endpoint or when disabled', () => {
  assert.equal(startTelemetry('babel-web', {}), null)
  assert.equal(
    startTelemetry('babel-web', {
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
      OTEL_SDK_DISABLED: 'true',
    }),
    null,
  )
  const span = babelTracer().startSpan('off')
  assert.equal(traceparent(span), null, 'no trace context leaves an idle process')
  span.end()
})

test('shutdown is bounded when the collector never answers', async () => {
  // Accept connections and never respond, like a blackholed collector.
  const collector = createServer(() => {})
  collector.listen(0, '127.0.0.1')
  await once(collector, 'listening')
  const { port } = collector.address() as AddressInfo
  const running = startTelemetry('babel-voice', {
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}/`,
  })
  assert.ok(running)
  const span = babelTracer().startSpan('pending export')
  assert.match(traceparent(span) ?? '', /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/u)
  span.end()
  const started = performance.now()
  await stopTelemetry(300)
  assert.ok(performance.now() - started < 1_500)
  collector.close()
})
