import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nicknameKey, nicknameSchema } from '../src/index.ts'

test('nickname comparison preserves case and uses NFC while display keeps the trimmed input', () => {
  assert.equal(nicknameSchema.parse('  Cafe\u0301  '), 'Cafe\u0301')
  assert.equal(nicknameKey('Cafe\u0301'), nicknameKey('Café'))
  assert.notEqual(nicknameKey('Player'), nicknameKey('player'))
  assert.equal(nicknameKey('  玩家一  '), '玩家一')
})

test('nickname validation rejects empty, control, format and overlong names', () => {
  for (const name of ['', '   ', 'a\nb', '\u0000玩家', '玩\u200b家', '字'.repeat(33)]) {
    assert.equal(nicknameSchema.safeParse(name).success, false, JSON.stringify(name))
  }
  assert.equal(nicknameSchema.safeParse('😀'.repeat(32)).success, true)
})
