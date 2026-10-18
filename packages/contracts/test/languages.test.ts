import assert from 'node:assert/strict'
import { test } from 'node:test'
import { selectOutputLanguage } from '../src/index.ts'

const enabled = [
  { code: 'zh-Hans', name: '简体中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
]

test('language selection follows saved, browser, default, first and empty fallbacks', () => {
  const cases: [string[], string | null, string | null, string][] = [
    [['ja-JP'], 'ko', 'zh-Hans', 'ko'],
    [['ja-JP'], 'disabled', 'zh-Hans', 'ja'],
    [['ko-KR'], null, 'zh-Hans', 'ko'],
    [['zh-CN'], null, 'ja', 'zh-Hans'],
    [['fr-FR', 'ja-JP'], null, 'ko', 'ja'],
    [['fr-FR'], null, 'ko', 'ko'],
    [['invalid_locale'], null, 'ko', 'ko'],
    [['fr-FR'], null, 'disabled', 'zh-Hans'],
  ]
  for (const [preferences, saved, fallback, expected] of cases) {
    assert.equal(selectOutputLanguage(enabled, preferences, saved, fallback), expected)
  }
  assert.equal(selectOutputLanguage([], ['ja-JP'], 'ja', 'ko'), null)
})

test('Simplified and Traditional Chinese remain distinct', () => {
  assert.equal(selectOutputLanguage(enabled, ['zh-TW'], null, 'ja'), 'ja')
  assert.equal(selectOutputLanguage(enabled, ['zh-HK'], null, 'ko'), 'ko')
  const chinese = [...enabled, { code: 'zh-Hant', name: '繁體中文' }]
  assert.equal(selectOutputLanguage(chinese, ['zh-TW'], null, 'ja'), 'zh-Hant')
  assert.equal(selectOutputLanguage(chinese, ['zh-Hans-TW']), 'zh-Hans')
})
