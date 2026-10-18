import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import type { Subtitle } from '@babel/contracts'
import { SubtitleView } from '../app/utils/subtitle-view.ts'

function command(
  speakerId: string,
  sequence: number,
  changes: Partial<Subtitle> = {},
): Subtitle {
  return {
    roomId: '00000000-0000-4000-8000-000000000001',
    sourceGeneration: 7,
    streamGeneration: 3,
    speakerId,
    speakerDisplayName: '同名成员',
    utteranceId: randomUUID(),
    sourceRevision: 1,
    translationRevision: 1,
    sequence,
    sourceLanguage: 'en',
    originalText: 'Do not attack.',
    outputLanguage: 'ja',
    translatedText: '攻撃しないで。',
    sourceIsFinal: true,
    translationIsFinal: true,
    configurationVersion: 2,
    audioStartMs: null,
    audioEndMs: null,
    serverSentAt: new Date().toISOString(),
    discontinuity: false,
    failure: null,
    ...changes,
  }
}

test('current commands follow speech order; corrections replace text and delayed translations cannot revive earlier orders', () => {
  const view = new SubtitleView()
  const first = command('one', 1)
  view.accept({ type: 'subtitle', value: first })
  const next = command('one', 2, {
    originalText: 'Retreat.',
    translatedText: '撤退して。',
  })
  view.accept({ type: 'subtitle', value: next })
  assert.equal(
    view.accept({ type: 'subtitle', value: { ...first, translationRevision: 99 } })
      .items[0]?.originalText,
    'Retreat.',
  )
  const other = command('two', 1, { originalText: 'Team two wait.' })
  view.accept({ type: 'subtitle', value: other })
  const stable = view.accept({
    type: 'subtitle',
    value: { ...next, translationRevision: 2 },
  })
  assert.deepEqual(
    stable.items.map((item) => item.speakerId),
    ['two', 'one'],
    'A late translation must not reorder the current speakers',
  )
  const corrected = {
    ...next,
    sourceRevision: 2,
    translationRevision: 2,
    originalText: 'Do not retreat.',
    translatedText: '',
    sourceIsFinal: false,
    translationIsFinal: false,
  }
  assert.equal(
    view.accept({ type: 'subtitle', value: corrected }).items[0]?.translatedText,
    '',
  )
  assert.equal(
    view.accept({ type: 'subtitle', value: next }).items[0]?.originalText,
    'Do not retreat.',
  )
  assert.equal(
    view.accept({
      type: 'subtitle',
      value: { ...corrected, translatedText: '撤退しないで。', translationRevision: 3 },
    }).items.length,
    2,
  )
})

test('old sources, recognition streams, configuration versions and delayed resets cannot overwrite current captions', () => {
  const view = new SubtitleView()
  const old = command('one', 10)
  view.accept({ type: 'subtitle', value: old })
  const fresh = command('one', 1, {
    sourceGeneration: 8,
    streamGeneration: 1,
    configurationVersion: 1,
  })
  view.accept({ type: 'subtitle', value: fresh })
  assert.equal(
    view.accept({ type: 'subtitle', value: old }).items[0]?.sourceGeneration,
    8,
  )
  const reconnect = { ...fresh, streamGeneration: 2, configurationVersion: 4 }
  view.accept({ type: 'subtitle', value: reconnect })
  view.accept({
    type: 'subtitle-state',
    roomId: fresh.roomId,
    sourceGeneration: 8,
    speakerId: 'one',
    streamGeneration: 1,
    outputLanguage: 'ja',
    state: 'UNAVAILABLE',
    failure: 'UNAVAILABLE',
  })
  assert.equal(
    view.accept({ type: 'subtitle', value: { ...reconnect, configurationVersion: 3 } })
      .items[0]?.configurationVersion,
    4,
  )
  assert.equal(
    view.accept({
      type: 'subtitle-state',
      roomId: fresh.roomId,
      sourceGeneration: 8,
      speakerId: null,
      streamGeneration: 0,
      outputLanguage: 'ja',
      state: 'STOPPED',
      failure: null,
    }).items.length,
    0,
  )
  assert.equal(
    view.accept({ type: 'subtitle', value: reconnect }).items.length,
    0,
    'A delayed caption cannot revive a source after its stop event',
  )
  assert.deepEqual(view.reset(), { items: [], state: 'WAITING', failure: null })
})
