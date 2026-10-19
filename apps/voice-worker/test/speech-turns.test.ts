import assert from 'node:assert/strict'
import { test } from 'node:test'
import { trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { CLEAN_GAP_MS, SpeechTurns, TURN_GAP_MS } from '../src/speech-turns.ts'

const exporter = new InMemorySpanExporter()
trace.setGlobalTracerProvider(
  new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
)
const roomId = '00000000-0000-4000-8000-000000000001'
const silence = Buffer.alloc(3840)
function speech() {
  const pcm = Buffer.alloc(3840)
  pcm.writeInt16LE(4000, 100)
  return pcm
}
// Separate provider events arrive in separate event-loop tasks.
const nextTask = () => new Promise((resolve) => setImmediate(resolve))
function spans(name: string) {
  return exporter.getFinishedSpans().filter((span) => span.name === name)
}

test('a speech onset traces the first translated revision once per language', async () => {
  exporter.reset()
  const turns = new SpeechTurns(roomId)
  turns.hear(silence, 1_000)
  assert.equal(turns.fragment('ja', 'a:1', 1_100), undefined, 'silence is not speech')
  await nextTask()
  turns.hear(speech(), 2_000)
  turns.hear(speech(), 2_020)
  const marker = turns.fragment('ja', 'a:2', 3_250)
  assert.ok(marker)
  assert.equal(marker.speechStartedAt, 2_000)
  assert.match(marker.traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/u)
  await nextTask()
  // Original-text updates repeat the translated revision and do not count.
  assert.equal(turns.fragment('ja', 'a:2', 3_400), undefined)
  await nextTask()
  assert.equal(turns.fragment('ja', 'a:3', 3_500), undefined, 'already measured')
  const korean = turns.fragment('ko', 'b:1', 4_000)
  assert.equal(korean?.speechStartedAt, 2_000)
  turns.close()

  const [turn] = spans('babel.speech.turn')
  const translations = spans('babel.subtitle.translation')
  assert.ok(turn)
  assert.equal(translations.length, 2)
  for (const span of translations) {
    assert.equal(span.parentSpanContext?.spanId, turn.spanContext().spanId)
    assert.equal(span.spanContext().traceId, turn.spanContext().traceId)
  }
  const japanese = translations.find(
    (span) => span.attributes['babel.output_language'] === 'ja',
  )
  assert.deepEqual(japanese?.duration, [1, 250_000_000])
  assert.equal(japanese?.attributes['babel.subtitle.attribution'], 'clean')
  assert.equal(marker.traceparent.slice(36, 52), japanese?.spanContext().spanId)
})

test('every subscriber of one fragment receives the same marker', async () => {
  const turns = new SpeechTurns(roomId)
  turns.hear(speech(), 10_000)
  const first = turns.fragment('ja', 'c:1', 11_000)
  const second = turns.fragment('ja', 'c:1', 11_000)
  assert.ok(first)
  assert.equal(second, first)
  await nextTask()
  assert.equal(turns.fragment('ja', 'c:1', 11_001), undefined, 'later repeat')
  turns.close()
})

test('a pause starts a new turn and a recent prior fragment is marked overlapped', async () => {
  const turns = new SpeechTurns(roomId)
  turns.hear(speech(), 20_000)
  assert.equal(turns.fragment('ja', 'd:1', 21_000)?.attribution, 'clean')
  await nextTask()
  turns.hear(speech(), 20_000 + TURN_GAP_MS - 1)
  assert.equal(turns.fragment('ja', 'd:2', 22_000), undefined, 'same turn')
  await nextTask()
  const onset = 22_000 + TURN_GAP_MS
  turns.hear(speech(), onset)
  const tail = turns.fragment('ja', 'd:3', 22_000 + CLEAN_GAP_MS - 1)
  assert.equal(tail?.speechStartedAt, onset)
  assert.equal(tail?.attribution, 'overlapped')
  turns.close()
})
