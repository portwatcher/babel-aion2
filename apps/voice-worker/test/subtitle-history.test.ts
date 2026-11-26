import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { SUBTITLE_HISTORY_WINDOW_MS, type Subtitle } from '@babel/contracts'
import { SubtitleHistoryCache } from '../src/subtitle-history.ts'

const roomA = '00000000-0000-4000-8000-000000000001'
const roomB = '00000000-0000-4000-8000-000000000002'

function subtitle(changes: Partial<Subtitle> = {}): Subtitle {
  return {
    roomId: roomA,
    sourceGeneration: 1,
    streamGeneration: 1,
    speakerId: 'speaker-1',
    speakerDisplayName: 'Commander',
    utteranceId: randomUUID(),
    sourceRevision: 1,
    translationRevision: 1,
    sequence: 1,
    sourceLanguage: 'en',
    originalText: 'Hold the gate.',
    outputLanguage: 'ja',
    translatedText: '門を守って。',
    sourceIsFinal: true,
    translationIsFinal: true,
    configurationVersion: 1,
    audioStartMs: null,
    audioEndMs: null,
    serverSentAt: new Date(1_700_000_000_000).toISOString(),
    discontinuity: false,
    failure: null,
    ...changes,
  }
}

test('caches translated records per room and language only for languages that produced translations', () => {
  const cache = new SubtitleHistoryCache()
  const t0 = 1_700_000_000_000
  const enabled = ['en', 'zh-Hans', 'ja', 'ko']

  cache.record(
    subtitle({
      outputLanguage: 'ja',
      translatedText: '門を守って。',
      latency: {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
        speechStartedAt: t0 - 500,
        attribution: 'clean',
      },
    }),
    t0,
  )
  cache.record(
    subtitle({
      roomId: roomB,
      outputLanguage: 'ko',
      translatedText: '문을 지켜.',
    }),
    t0 + 1_000,
  )

  const jaRoomA = cache.read(roomA, 'ja', enabled, t0 + 5_000)
  assert.deepEqual(jaRoomA.availableLanguages, ['ja'])
  assert.equal(jaRoomA.outputLanguage, 'ja')
  assert.equal(jaRoomA.items.length, 1)
  assert.equal(jaRoomA.items[0]?.translatedText, '門を守って。')
  assert.doesNotMatch(
    JSON.stringify(jaRoomA),
    /traceparent|speechStartedAt/u,
    'private latency trace context never enters subtitle history',
  )

  const koRoomA = cache.read(roomA, 'ko', enabled, t0 + 5_000)
  assert.deepEqual(koRoomA.availableLanguages, ['ja'])
  assert.equal(koRoomA.outputLanguage, 'ko')
  assert.deepEqual(koRoomA.items, [], 'unlistened language has no records')

  const disabledJa = cache.read(roomA, 'ja', ['en', 'ko'], t0 + 5_000)
  assert.equal(disabledJa.outputLanguage, null)
  assert.deepEqual(disabledJa.availableLanguages, [])
  assert.deepEqual(disabledJa.items, [])

  const koRoomB = cache.read(roomB, 'ko', enabled, t0 + 5_000)
  assert.deepEqual(koRoomB.availableLanguages, ['ko'])
  assert.equal(koRoomB.items.length, 1)
  assert.equal(koRoomB.items[0]?.translatedText, '문을 지켜.')
})

test('updates utterances in place, rejects stale revisions, handles slicing and retractions, and skips failures', () => {
  const cache = new SubtitleHistoryCache()
  const t0 = 1_700_000_000_000
  const utteranceOne = randomUUID()
  const utteranceTwo = randomUUID()
  const retractedId = randomUUID()

  // Source-only delta before translation arrives is not recorded as a translation.
  cache.record(
    subtitle({
      utteranceId: utteranceOne,
      originalText: 'Wait',
      translatedText: '',
      sourceIsFinal: false,
      translationIsFinal: false,
      translationRevision: 0,
    }),
    t0,
  )
  assert.equal(cache.read(roomA, 'ja', ['ja'], t0).items.length, 0)

  // First translated revision records the utterance.
  cache.record(
    subtitle({
      utteranceId: utteranceOne,
      originalText: 'Wait here',
      translatedText: 'ここで待って',
      sourceRevision: 2,
      translationRevision: 1,
      sourceIsFinal: false,
      translationIsFinal: false,
    }),
    t0 + 1_000,
  )
  // Second utterance starts before utteranceOne finalizes.
  cache.record(
    subtitle({
      utteranceId: utteranceTwo,
      speakerId: 'speaker-2',
      sequence: 2,
      originalText: 'Roger.',
      translatedText: '了解。',
    }),
    t0 + 2_000,
  )
  // Utterance one finalizes; chronological order and recordedAt stay anchored.
  cache.record(
    subtitle({
      utteranceId: utteranceOne,
      originalText: 'Wait here.',
      translatedText: 'ここで待って。',
      sourceRevision: 3,
      translationRevision: 2,
      sourceIsFinal: true,
      translationIsFinal: true,
    }),
    t0 + 3_000,
  )
  // Older revision and shorter same-revision mid-utterance slice cannot overwrite.
  cache.record(
    subtitle({
      utteranceId: utteranceOne,
      originalText: 'Wait',
      translatedText: '待って',
      sourceRevision: 2,
      translationRevision: 1,
    }),
    t0 + 4_000,
  )
  cache.record(
    subtitle({
      utteranceId: utteranceOne,
      originalText: 'here.',
      translatedText: '待って。',
      sourceRevision: 3,
      translationRevision: 2,
    }),
    t0 + 4_100,
  )
  // Failed subtitle frames never enter history.
  cache.record(
    subtitle({
      utteranceId: randomUUID(),
      translatedText: 'Ignored failure',
      failure: 'UNAVAILABLE',
    }),
    t0 + 4_200,
  )
  // Retracted utterance is removed.
  cache.record(
    subtitle({ utteranceId: retractedId, originalText: 'Oops', translatedText: 'あ' }),
    t0 + 4_300,
  )
  cache.record(
    subtitle({
      utteranceId: retractedId,
      originalText: '',
      translatedText: '',
      sourceRevision: 2,
      translationRevision: 2,
    }),
    t0 + 4_400,
  )

  const history = cache.read(roomA, 'ja', ['ja'], t0 + 5_000)
  assert.deepEqual(
    history.items.map((item) => item.utteranceId),
    [utteranceOne, utteranceTwo],
  )
  assert.equal(history.items[0]?.translatedText, 'ここで待って。')
  assert.equal(history.items[0]?.originalText, 'Wait here.')
  assert.equal(history.items[0]?.recordedAt, new Date(t0 + 1_000).toISOString())
  assert.equal(history.items[0]?.updatedAt, new Date(t0 + 3_000).toISOString())
  assert.equal(history.items[0]?.translationIsFinal, true)
})

test('expires entries after five minutes and bounds per-language capacity', () => {
  const cache = new SubtitleHistoryCache(SUBTITLE_HISTORY_WINDOW_MS)
  const t0 = 1_700_000_000_000

  cache.record(subtitle({ outputLanguage: 'ja', translatedText: '古い指示。' }), t0)
  cache.record(
    subtitle({ outputLanguage: 'ja', translatedText: '新しい指示。' }),
    t0 + 120_000,
  )

  const afterFourMin = cache.read(roomA, 'ja', ['ja'], t0 + 240_000)
  assert.equal(afterFourMin.items.length, 2)

  const afterSixMin = cache.read(roomA, 'ja', ['ja'], t0 + 360_000)
  assert.deepEqual(
    afterSixMin.items.map((item) => item.translatedText),
    ['新しい指示。'],
  )
  assert.deepEqual(afterSixMin.availableLanguages, ['ja'])

  const afterEightMin = cache.read(roomA, 'ja', ['ja'], t0 + 480_000)
  assert.deepEqual(afterEightMin.items, [])
  assert.deepEqual(afterEightMin.availableLanguages, [])

  // Bounded capacity retains only the newest 200 entries per room/language.
  for (let i = 0; i < 230; i += 1) {
    cache.record(
      subtitle({
        outputLanguage: 'ko',
        sequence: i + 1,
        translatedText: `명령 ${i}`,
      }),
      t0 + 500_000 + i * 100,
    )
  }
  const bounded = cache.read(roomA, 'ko', ['ko'], t0 + 530_000)
  assert.equal(bounded.items.length, 200)
  assert.equal(bounded.items[0]?.translatedText, '명령 30')
  assert.equal(bounded.items[199]?.translatedText, '명령 229')
})
