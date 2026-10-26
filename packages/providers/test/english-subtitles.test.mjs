import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { openSharedSubtitleStream } from '../src/index.ts'
import { createProviderFixture } from '../../../scripts/fixtures/provider-server.mjs'
import { routeProviderNetwork } from '../../../scripts/fixtures/provider-network.mjs'

const settings = { type: 'openai', timeoutMs: 3000 }
const subtitles = (events) => events.filter((event) => event.type === 'subtitle')
async function until(predicate) {
  const deadline = Date.now() + 2000
  while (!predicate() && Date.now() < deadline) {
    await setTimeout(5)
  }
  assert.ok(predicate(), 'expected subtitle delivery')
}
async function fixture(t, outputLanguage = 'en') {
  const network = await createProviderFixture()
  const restore = routeProviderNetwork(network.origin)
  const key = network.credential()
  const stream = openSharedSubtitleStream({
    recognition: { settings, credential: key },
    sampleRate: 48000,
    terminology: null,
  })
  t.after(async () => {
    stream.close()
    restore()
    await network.close()
  })
  const path = { settings, credential: key, outputLanguage, version: 1 }
  const events = []
  stream.subscribe(path, (event) => events.push(event))
  await stream.prepare()
  const source = network.observations.find((value) => value.protocol === 'recognition')
  const target = network.observations.find((value) => value.protocol === 'translation')
  return {
    events,
    stream,
    path,
    network,
    key,
    source(item, text, final = false) {
      network.emit(
        key,
        {
          type: `conversation.item.input_audio_transcription.${final ? 'completed' : 'delta'}`,
          item_id: item,
          [final ? 'transcript' : 'delta']: text,
        },
        source,
      )
    },
    target(text) {
      network.emit(
        key,
        {
          type: 'session.output_transcript.delta',
          event_id: crypto.randomUUID(),
          delta: text,
        },
        target,
      )
    },
    failTarget() {
      network.emit(
        key,
        { type: 'error', error: { code: 'insufficient_quota' } },
        target,
      )
    },
    latest() {
      return subtitles(events).at(-1)?.value
    },
  }
}

test('English output uses incremental original captions, corrections and finality, including regional English', async (t) => {
  const f = await fixture(t, 'en-US')
  f.source('first', 'Wait 3 seconds.')
  await until(() => f.latest()?.text === 'Wait 3 seconds.')
  assert.equal(f.latest().translatedText, 'Wait 3 seconds.')
  assert.equal(f.latest().language, 'en')
  assert.equal(f.latest().translationIsFinal, false)
  assert.equal(f.latest().sourceAlignment, 'aligned')
  const first = f.latest()
  const late = []
  f.stream.subscribe(f.path, (event) => late.push(event))
  f.target('A translator must never replace the original English.')
  f.source('first', ' Then move left.')
  await until(() => f.latest()?.translatedText.endsWith('Then move left.'))
  assert.equal(f.latest().utteranceId, first.utteranceId)
  assert.equal(f.latest().sequence, first.sequence)
  assert.equal(subtitles(late).at(-1).value.translatedText, ' Then move left.')
  f.source('first', 'Wait 2 seconds. Then move left.', true)
  await until(() => f.latest()?.translationIsFinal)
  assert.equal(f.latest().translatedText, 'Wait 2 seconds. Then move left.')
  f.source('second', 'Do not attack.')
  await until(() => f.latest()?.text === 'Do not attack.')
  assert.equal(f.latest().translatedText, 'Do not attack.')
  assert.notEqual(f.latest().utteranceId, first.utteranceId)
  assert.ok(f.latest().sequence > first.sequence)
  f.source('second', '', true)
  await until(() => f.latest()?.text === '')
  assert.equal(f.latest().translatedText, '', 'retracted source clears direct output')
})

test('non-English and uncertain source text keep English translation and can follow direct English', async (t) => {
  const f = await fixture(t)
  f.source('english', 'Wait 3 seconds.')
  await until(() => f.latest()?.text === 'Wait 3 seconds.')
  for (const [item, text] of [
    ['chinese', '不要攻击，向左撤退。'],
    ['japanese', '攻撃しないで、左に撤退してください。'],
    ['korean', '공격하지 말고 왼쪽으로 후퇴하세요.'],
    ['french', 'Ne pas attaquer, reculez vers la gauche.'],
    ['spanish', 'No ataques, retírate hacia la izquierda.'],
    ['uncertain', '123'],
  ]) {
    f.source(item, text)
    await until(() => f.latest()?.text === text)
    f.target(`Translated ${item}.`)
    await until(() => f.latest()?.translatedText === `Translated ${item}.`)
    assert.notEqual(f.latest().translatedText, text)
    assert.equal(f.latest().sourceAlignment, 'independent')
  }
})

test('a failed translation connection cannot prevent direct English captions', async (t) => {
  const f = await fixture(t)
  f.source('english', 'Wait 3 seconds.')
  await until(() => f.latest()?.text === 'Wait 3 seconds.')
  const count = f.events.length
  f.failTarget()
  f.source('english', 'Wait 2 seconds.', true)
  await until(() => f.latest()?.translationIsFinal)
  assert.equal(f.latest().translatedText, 'Wait 2 seconds.')
  assert.equal(f.latest().failure, null)
  assert.equal(
    f.events.slice(count).some((event) => event.type === 'failure'),
    false,
  )
})
