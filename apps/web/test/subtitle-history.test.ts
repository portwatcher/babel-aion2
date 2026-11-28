import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import {
  SUBTITLE_HISTORY_WINDOW_MS,
  type Subtitle,
  type SubtitleHistory,
  type SubtitleHistoryItem,
} from '@babel/contracts'
import { SubtitleHistoryView } from '../app/utils/subtitle-history.ts'

const roomId = '00000000-0000-4000-8000-000000000001'

function historyItem(changes: Partial<SubtitleHistoryItem> = {}): SubtitleHistoryItem {
  const timestamp = new Date(1_700_000_000_000).toISOString()
  return {
    roomId,
    sourceGeneration: 2,
    streamGeneration: 1,
    speakerId: 'speaker-1',
    speakerDisplayName: 'Commander',
    utteranceId: randomUUID(),
    sourceRevision: 1,
    translationRevision: 1,
    sequence: 1,
    sourceLanguage: 'en',
    originalText: 'Attack east.',
    outputLanguage: 'ja',
    translatedText: '東を攻撃。',
    sourceIsFinal: true,
    translationIsFinal: true,
    configurationVersion: 1,
    recordedAt: timestamp,
    updatedAt: timestamp,
    ...changes,
  }
}

function liveSubtitle(changes: Partial<Subtitle> = {}): Subtitle {
  return {
    roomId,
    sourceGeneration: 2,
    streamGeneration: 1,
    speakerId: 'speaker-1',
    speakerDisplayName: 'Commander',
    utteranceId: randomUUID(),
    sourceRevision: 1,
    translationRevision: 1,
    sequence: 1,
    sourceLanguage: 'en',
    originalText: 'Fall back.',
    outputLanguage: 'ja',
    translatedText: '撤退して。',
    sourceIsFinal: true,
    translationIsFinal: true,
    configurationVersion: 1,
    audioStartMs: null,
    audioEndMs: null,
    serverSentAt: new Date(1_700_000_060_000).toISOString(),
    discontinuity: false,
    failure: null,
    ...changes,
  }
}

test('compensates for client clock skew when hydrating and expiring five-minute history', () => {
  const view = new SubtitleHistoryView()
  const serverNowMs = 1_700_000_200_000
  // Browser clock is two hours ahead of the server clock.
  const localNowMs = serverNowMs + 2 * 60 * 60_000
  const older = historyItem({
    translatedText: '四分前の指示。',
    recordedAt: new Date(serverNowMs - 240_000).toISOString(),
    updatedAt: new Date(serverNowMs - 240_000).toISOString(),
  })
  const newer = historyItem({
    sequence: 2,
    translatedText: '一分前の指示。',
    recordedAt: new Date(serverNowMs - 60_000).toISOString(),
    updatedAt: new Date(serverNowMs - 60_000).toISOString(),
  })
  const snapshot: SubtitleHistory = {
    roomId,
    outputLanguage: 'ja',
    windowMs: SUBTITLE_HISTORY_WINDOW_MS,
    availableLanguages: ['ja'],
    items: [older, newer],
    serverNow: new Date(serverNowMs).toISOString(),
  }

  const hydrated = view.hydrate(snapshot, localNowMs)
  assert.deepEqual(
    hydrated.map((item) => item.translatedText),
    ['四分前の指示。', '一分前の指示。'],
    'skewed browser clock does not discard recent server records',
  )

  // 65 seconds later locally, the 4-minute-old item expires while the 1-minute-old remains.
  const after65s = view.prune(localNowMs + 65_000)
  assert.equal(after65s.changed, true)
  assert.deepEqual(
    after65s.items.map((item) => item.translatedText),
    ['一分前の指示。'],
  )

  // 250 seconds later locally, the remaining item also expires.
  const after250s = view.prune(localNowMs + 250_000)
  assert.equal(after250s.changed, true)
  assert.deepEqual(after250s.items, [])
})

test('merges live utterances arriving during history fetch in chronological order and handles language switches', () => {
  const view = new SubtitleHistoryView()
  const serverNowMs = 1_700_000_100_000
  const localNowMs = serverNowMs
  const liveId = randomUUID()
  const olderId = randomUUID()

  // Live utterance arrives over WebSocket before the HTTP history snapshot resolves.
  view.accept(
    liveSubtitle({
      utteranceId: liveId,
      sequence: 3,
      originalText: 'Hold now.',
      translatedText: '今止まって。',
      sourceRevision: 2,
      translationRevision: 2,
      translationIsFinal: true,
      serverSentAt: new Date(serverNowMs + 500).toISOString(),
    }),
    localNowMs + 500,
  )

  // HTTP snapshot arrives containing an earlier cached utterance and an older revision of liveId.
  const merged = view.hydrate(
    {
      roomId,
      outputLanguage: 'ja',
      windowMs: SUBTITLE_HISTORY_WINDOW_MS,
      availableLanguages: ['ja'],
      serverNow: new Date(serverNowMs).toISOString(),
      items: [
        historyItem({
          utteranceId: olderId,
          sequence: 1,
          translatedText: '前の指示。',
          recordedAt: new Date(serverNowMs - 30_000).toISOString(),
          updatedAt: new Date(serverNowMs - 30_000).toISOString(),
        }),
        historyItem({
          utteranceId: liveId,
          sequence: 3,
          originalText: 'Hold',
          translatedText: '止まって',
          sourceRevision: 1,
          translationRevision: 1,
          translationIsFinal: false,
          recordedAt: new Date(serverNowMs - 200).toISOString(),
          updatedAt: new Date(serverNowMs - 200).toISOString(),
        }),
      ],
    },
    localNowMs + 600,
  )

  assert.deepEqual(
    merged.map((item) => item.utteranceId),
    [olderId, liveId],
    'cached items stay before newer live items in chronological order',
  )
  assert.equal(
    merged[1]?.translatedText,
    '今止まって。',
    'older snapshot revision cannot regress a newer live revision',
  )
  assert.equal(
    merged[1]?.recordedAt,
    new Date(serverNowMs - 200).toISOString(),
    'earliest recorded timestamp is preserved',
  )

  // Cross-language event is ignored while on ja.
  const unchanged = view.accept(
    liveSubtitle({ outputLanguage: 'ko', translatedText: '다른 언어' }),
    localNowMs + 700,
  )
  assert.equal(unchanged.length, 2)

  // Retraction removes an existing utterance.
  const afterRetract = view.accept(
    liveSubtitle({
      utteranceId: liveId,
      originalText: '',
      translatedText: '',
      sourceRevision: 3,
      translationRevision: 3,
    }),
    localNowMs + 800,
  )
  assert.deepEqual(
    afterRetract.map((item) => item.utteranceId),
    [olderId],
  )

  // Switching to an unlistened language resets previous history and shows no records.
  assert.deepEqual(view.reset(), [])
  const switchedEmpty = view.hydrate(
    {
      roomId,
      outputLanguage: 'ko',
      windowMs: SUBTITLE_HISTORY_WINDOW_MS,
      availableLanguages: ['ja'],
      serverNow: new Date(serverNowMs + 1_000).toISOString(),
      items: [],
    },
    localNowMs + 1_000,
  )
  assert.deepEqual(switchedEmpty, [])
})
