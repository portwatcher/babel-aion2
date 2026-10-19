import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { babelMeter, babelTracer, startTelemetry, stopTelemetry } from '../src/index.ts'

test('spans and histograms reach the configured OTLP/HTTP collector on shutdown', async () => {
  const requests: Array<{ url: string; body: string }> = []
  const collector = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => (body += chunk))
    request.on('end', () => {
      requests.push({ url: request.url ?? '', body })
      response.writeHead(200, { 'content-type': 'application/json' }).end('{}')
    })
  })
  collector.listen(0, '127.0.0.1')
  await once(collector, 'listening')
  const { port } = collector.address() as AddressInfo
  assert.ok(
    startTelemetry('babel-web', {
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
    }),
  )
  babelTracer().startSpan('babel.subtitle.web_relay').end()
  babelMeter().createHistogram('babel.subtitle.visible_latency').record(1_234)
  await stopTelemetry(5_000)
  collector.close()

  const traces = requests.find((request) => request.url === '/v1/traces')
  const metrics = requests.find((request) => request.url === '/v1/metrics')
  assert.ok(traces, 'trace export')
  assert.ok(metrics, 'metric export')
  assert.match(traces.body, /babel\.subtitle\.web_relay/u)
  assert.match(traces.body, /"service\.name".*"babel-web"/u)
  assert.match(metrics.body, /babel\.subtitle\.visible_latency/u)
})
