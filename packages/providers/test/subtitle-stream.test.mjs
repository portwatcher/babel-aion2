import assert from 'node:assert/strict'
import { test } from 'node:test'
import { setTimeout } from 'node:timers/promises'
import { openSharedSubtitleStream, readPcmWave } from '../src/index.ts'
import { sendPcmAudio } from '../src/pcm.ts'
import { createProviderFixture } from '../../../scripts/fixtures/provider-server.mjs'
import { routeProviderNetwork } from '../../../scripts/fixtures/provider-network.mjs'
import { syntheticWave } from '../../../scripts/fixtures/audio-sample.mjs'

async function until(predicate, message, timeout = 4_000) {
  const deadline = Date.now() + timeout
  while (!predicate() && Date.now() < deadline) {
    await setTimeout(10)
  }
  assert.ok(predicate(), message)
}
const token = (text, is_final = false) => ({ text, is_final, language: 'en' })
const values = (events) =>
  events.filter((event) => event.type === 'subtitle').map((event) => event.value)
const translated = (events) => values(events).filter((value) => value.translatedText)
function path(network, code, key = network.credential('echo'), version = 1) {
  return {
    outputLanguage: code,
    version,
    credential: key,
    settings: {
      type: 'deepl',
      endpoint: 'https://api-free.deepl.com',
      model: 'prefer_quality_optimized',
      timeoutMs: 15_000,
    },
  }
}
function source(network, key, signal) {
  return openSharedSubtitleStream({
    recognition: {
      settings: { type: 'soniox', model: 'stt-rt-v5', timeoutMs: 3_000 },
      credential: key,
    },
    sampleRate: 48_000,
    terminology: null,
    signal,
  })
}
async function manual(network, stream, key) {
  await stream.ready
  stream.write(new Uint8Array(1920), 0)
  await until(
    () =>
      network.observations.some((value) => value.key === key && value.configuration),
    'Recognition has accepted its configuration',
  )
}

test('one recognition stream shares translations, preserves speech corrections, and keeps slow languages off audio input', async () => {
  const network = await createProviderFixture()
  const restore = routeProviderNetwork(network.origin)
  const stream = source(network, network.credential('speech'))
  const japanese = path(network, 'ja')
  const korean = path(network, 'ko')
  const hold = network.hold(japanese.credential)
  const a = [],
    b = [],
    k = []
  try {
    stream.subscribe(japanese, (event) => a.push(event))
    stream.subscribe(
      {
        credential: japanese.credential,
        version: japanese.version,
        settings: {
          timeoutMs: 15_000,
          model: 'prefer_quality_optimized',
          endpoint: 'https://api-free.deepl.com',
          type: 'deepl',
        },
        outputLanguage: 'ja',
      },
      (event) => b.push(event),
    )
    stream.subscribe(korean, (event) => k.push(event))
    let complete = false
    const sent = sendPcmAudio(
      stream,
      readPcmWave(syntheticWave()),
      AbortSignal.timeout(12_000),
    ).then(() => {
      complete = true
    })
    await hold.started
    await until(
      () => translated(k).length === 2,
      'Korean finishes independently of the held Japanese request',
    )
    await until(
      () => network.observations.find((value) => value.protocol === 'soniox')?.end,
      'All audio reaches recognition while Japanese is still held',
    )
    assert.equal(complete, false)
    const recognition = network.observations.filter(
      (value) => value.protocol === 'soniox',
    )
    assert.equal(recognition.length, 1)
    assert.equal(recognition[0].frames.length, 50)
    assert.equal(translated(a).length, 0)
    hold.release()
    await sent
    assert.deepEqual(a, b, 'Same-language subscribers receive the same revisions')
    for (const [events, target] of [
      [a, 'JA'],
      [k, 'KO'],
    ]) {
      assert.deepEqual(
        translated(events).map((value) => [
          value.text,
          value.translatedText,
          value.sequence,
          value.translationIsFinal,
        ]),
        [
          ['Do not attack', `fixture:${target}:Do not attack`, 1, true],
          ['Wait 3 seconds.', `fixture:${target}:Wait 3 seconds.`, 2, true],
        ],
      )
      assert.equal(
        network.observations.filter((value) => value.body?.target_lang === target)
          .length,
        2,
        'Jobs scale with language, not subscriber count',
      )
    }
  } finally {
    stream.close()
    restore()
    await network.close()
  }
})

test('revisions, retractions and path replacement discard obsolete HTTP results without restarting recognition', async () => {
  const network = await createProviderFixture()
  const restore = routeProviderNetwork(network.origin)
  const recognitionKey = network.credential()
  const stream = source(network, recognitionKey)
  const original = path(network, 'ja')
  const events = []
  try {
    stream.subscribe(original, (event) => events.push(event))
    await manual(network, stream, recognitionKey)
    const old = network.hold(original.credential)
    network.transcript(recognitionKey, [token('Attack')])
    await old.started
    network.transcript(recognitionKey, [token('Do not attack')])
    await until(
      () =>
        network.observations.filter((value) => value.protocol === 'deepl').length === 2,
      'A correction replaces in-flight provisional work',
    )
    assert.equal(
      network.observations.find((value) => value.body?.text[0] === 'Attack').closed,
      true,
    )
    old.release()
    await until(
      () => translated(events).length === 1,
      'Only the current correction becomes translated text',
    )
    assert.equal(translated(events)[0].translatedText, 'fixture:JA:Do not attack')
    assert.equal(translated(events)[0].translationIsFinal, false)
    network.transcript(recognitionKey, [
      token('Do not attack', true),
      token('<end>', true),
    ])
    await until(
      () => translated(events).at(-1)?.translationIsFinal,
      'Finality updates without translating identical text again',
    )
    assert.equal(
      network.observations.filter((value) => value.protocol === 'deepl').length,
      2,
    )

    const withdrawn = network.hold(original.credential)
    network.transcript(recognitionKey, [token('Retreat')])
    await withdrawn.started
    network.transcript(recognitionKey, [])
    await until(
      () => values(events).at(-1)?.text === '',
      'A retraction immediately clears the current source and translation',
    )
    assert.equal(values(events).at(-1).translatedText, '')
    await until(
      () =>
        network.observations.find((value) => value.body?.text[0] === 'Retreat')?.closed,
      'Retracted work is cancelled',
    )
    withdrawn.release()

    const obsolete = network.hold(original.credential)
    network.transcript(recognitionKey, [token('Old order')])
    await obsolete.started
    const next = path(network, 'ja', network.credential('echo'), 2)
    stream.replaceOutput(next)
    const reset = events.findIndex((event) => event.type === 'reset')
    assert.ok(reset >= 0)
    network.transcript(recognitionKey, [token('Wait', true), token('<end>', true)])
    await until(
      () => translated(events).at(-1)?.text === 'Wait',
      'New configuration accepts only current speech',
    )
    obsolete.release()
    await stream.end()
    assert.ok(
      values(events.slice(reset)).every((value) => value.configurationVersion === 2),
    )
    assert.deepEqual(
      translated(events.slice(reset)).map((value) => value.translatedText),
      ['fixture:JA:Wait'],
    )
    assert.equal(
      network.observations.filter((value) => value.protocol === 'soniox').length,
      1,
    )
    assert.equal(
      translated(events).some((value) =>
        ['Attack', 'Retreat', 'Old order'].includes(value.text),
      ),
      false,
    )
  } finally {
    stream.close()
    restore()
    await network.close()
  }
})

test('new subscribers receive no queued history and unused streams are released after the grace period', async () => {
  const network = await createProviderFixture()
  const restore = routeProviderNetwork(network.origin)
  const recognitionKey = network.credential()
  const stream = source(network, recognitionKey)
  const output = path(network, 'ja')
  const first = [],
    late = []
  try {
    const leaveFirst = stream.subscribe(output, (event) => first.push(event))
    await manual(network, stream, recognitionKey)
    const hold = network.hold(output.credential)
    network.transcript(recognitionKey, [
      token('Before entry', true),
      token('<end>', true),
    ])
    await hold.started
    const leaveLate = stream.subscribe(output, (event) => late.push(event))
    hold.release()
    await until(
      () => translated(first).length === 1,
      'The existing subscriber receives its command',
    )
    assert.deepEqual(
      late,
      [],
      'Neither cached nor in-flight earlier commands are replayed to a new subscriber',
    )
    leaveFirst()
    network.transcript(recognitionKey, [
      token('After entry', true),
      token('<end>', true),
    ])
    await until(
      () => translated(late).length === 1,
      'The remaining subscriber receives new speech',
    )
    assert.equal(translated(first).length, 1)
    leaveLate()
    await assert.rejects(stream.finished, (error) => error.code === 'UNAVAILABLE')
    await until(
      () => network.observations.find((value) => value.protocol === 'soniox')?.closed,
      'The unused recognition connection actually closes',
    )
  } finally {
    stream.close()
    restore()
    await network.close()
  }
})

test('recognition failure cancels old translation and a new source cannot publish its late results', async () => {
  const network = await createProviderFixture()
  const restore = routeProviderNetwork(network.origin)
  const oldKey = network.credential()
  const old = source(network, oldKey)
  let next
  const output = path(network, 'ja')
  const oldEvents = [],
    nextEvents = []
  try {
    old.subscribe(output, (event) => oldEvents.push(event))
    await manual(network, old, oldKey)
    const hold = network.hold(output.credential)
    network.transcript(oldKey, [token('Old generation', true), token('<end>', true)])
    await hold.started
    network.disconnect(oldKey)
    await assert.rejects(old.finished, (error) => error.code === 'INVALID_RESPONSE')
    await until(
      () =>
        network.observations.find((value) => value.body?.text[0] === 'Old generation')
          ?.closed,
      'Source failure cancels its actual HTTP request',
    )
    const nextKey = network.credential()
    next = source(network, nextKey)
    next.subscribe(path(network, 'ja'), (event) => nextEvents.push(event))
    await manual(network, next, nextKey)
    network.transcript(nextKey, [
      token('Current generation', true),
      token('<end>', true),
    ])
    hold.release()
    await next.end()
    assert.equal(translated(oldEvents).length, 0)
    assert.deepEqual(
      oldEvents.filter((event) => event.type === 'failure'),
      [{ type: 'failure', code: 'INVALID_RESPONSE' }],
    )
    assert.deepEqual(
      translated(nextEvents).map((value) => value.translatedText),
      ['fixture:JA:Current generation'],
    )
  } finally {
    old.close()
    next?.close()
    restore()
    await network.close()
  }
})

test('cancellation still bounds translation after recognition has already finished', async () => {
  const network = await createProviderFixture()
  const restore = routeProviderNetwork(network.origin)
  const cancellation = new AbortController()
  const recognitionKey = network.credential()
  const stream = source(network, recognitionKey, cancellation.signal)
  const output = path(network, 'ja')
  const events = []
  try {
    stream.subscribe(output, (event) => events.push(event))
    await manual(network, stream, recognitionKey)
    const hold = network.hold(output.credential)
    network.transcript(recognitionKey, [token('Wait', true), token('<end>', true)])
    await hold.started
    const finished = stream.end()
    void finished.catch(() => {})
    await until(
      () => network.observations.find((value) => value.protocol === 'soniox')?.closed,
      'Recognition is already complete before the deadline expires',
    )
    cancellation.abort()
    await assert.rejects(
      Promise.race([
        finished,
        setTimeout(500).then(() => {
          throw new Error('Cancellation left translation running')
        }),
      ]),
      (error) => error.code === 'TIMEOUT',
    )
    await until(
      () => network.observations.find((value) => value.protocol === 'deepl')?.closed,
      'The total deadline cancels the actual translation request',
    )
    hold.release()
    assert.equal(translated(events).length, 0)
  } finally {
    stream.close()
    restore()
    await network.close()
  }
})

test('a full translation queue discards old work, marks discontinuity and retains bounded current commands', async () => {
  const network = await createProviderFixture()
  const restore = routeProviderNetwork(network.origin)
  const recognitionKey = network.credential()
  const stream = source(network, recognitionKey)
  const output = path(network, 'ja')
  const events = []
  try {
    stream.subscribe(output, (event) => events.push(event))
    await manual(network, stream, recognitionKey)
    const hold = network.hold(output.credential)
    network.transcript(recognitionKey, [token('Obsolete', true), token('<end>', true)])
    await hold.started
    network.transcript(
      recognitionKey,
      Array.from({ length: 40 }, (_, index) => [
        token(`Command ${index}`, true),
        token('<end>', true),
      ]).flat(),
    )
    await until(
      () => values(events).some((value) => value.discontinuity),
      'Dropping queued commands is explicitly signalled',
    )
    hold.release()
    await stream.end()
    const results = translated(events)
    assert.equal(results.length, 32)
    assert.deepEqual(
      results.map((value) => value.text),
      Array.from({ length: 32 }, (_, index) => `Command ${index + 8}`),
    )
    assert.equal(results.at(-1).sequence, 41)
    assert.ok(
      network.observations.filter((value) => value.protocol === 'deepl').length <= 33,
    )
  } finally {
    stream.close()
    restore()
    await network.close()
  }
})
