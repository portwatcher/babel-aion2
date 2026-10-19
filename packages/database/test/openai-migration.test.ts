import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import pg from 'pg'

test('retiring unsupported providers revokes their paths and encrypted history while preserving OpenAI configuration', async () => {
  const url = new URL(process.env.DATABASE_URL ?? '')
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  const client = new pg.Client({ connectionString: url.toString() })
  await client.connect()
  const retired = randomUUID(),
    current = randomUUID(),
    room = randomUUID()
  const language = 'qaa-x-' + randomUUID().slice(0, 8)
  const preservedLanguage = 'qaa-x-' + randomUUID().slice(0, 8)
  const preservedRoom = randomUUID()
  try {
    await client.query('begin')
    await client.query(
      `insert into provider_configuration(id, name, provider_type, purpose, encrypted_credential, public_settings)
      values ($1, 'Retired fixture', 'retired-provider', 'recognition', 'synthetic-envelope', '{}'),
             ($2, 'OpenAI fixture', 'openai', 'speech_translation', 'protected-fixture', '{"type":"openai","timeoutMs":15000}')`,
      [retired, current],
    )
    await client.query(
      `insert into provider_revision(configuration_id, version, name, settings, encrypted_credential)
      values ($1, 1, 'Retired history', '{}', 'synthetic-history')`,
      [retired],
    )
    await client.query(
      `insert into output_language(code, name, enabled, recognition_configuration_id, translation_configuration_id, path_validated_at, validation, last_attempt, version, path_version)
      values ($1, 'Retired path', true, $2, $3, now(), '{}', '{}', 5, 7)`,
      [language, retired, current],
    )
    await client.query(
      'insert into room(id, name, default_output_language) values ($1, $2, $3)',
      [room, 'Migration fixture', language],
    )
    await client.query(
      'insert into output_language(code, name, enabled, recognition_configuration_id, translation_configuration_id) values ($1, $2, false, $3, $3)',
      [preservedLanguage, 'Current draft', current],
    )
    await client.query(
      'insert into room(id, name, default_output_language) values ($1, $2, $3)',
      [preservedRoom, 'Current default', preservedLanguage],
    )
    await client.query(
      await readFile(
        new URL('../migrations/0014_openai_streaming.sql', import.meta.url),
        'utf8',
      ),
    )
    assert.equal(
      (
        await client.query('select id from provider_configuration where id=$1', [
          retired,
        ])
      ).rowCount,
      0,
    )
    assert.equal(
      (
        await client.query(
          'select id from provider_revision where configuration_id=$1',
          [retired],
        )
      ).rowCount,
      0,
    )
    const preserved = (
      await client.query(
        'select encrypted_credential from provider_configuration where id=$1',
        [current],
      )
    ).rows[0]
    assert.equal(preserved.encrypted_credential, 'protected-fixture')
    assert.equal(
      (
        await client.query('select default_output_language from room where id=$1', [
          preservedRoom,
        ])
      ).rows[0].default_output_language,
      preservedLanguage,
    )
    const path = (
      await client.query('select * from output_language where code=$1', [language])
    ).rows[0]
    assert.equal(path.enabled, false)
    assert.equal(path.recognition_configuration_id, null)
    assert.equal(path.translation_configuration_id, null)
    assert.equal(path.path_validated_at, null)
    assert.equal(path.validation, null)
    assert.equal(path.last_attempt, null)
    assert.equal(path.version, 6)
    assert.equal(path.path_version, 8)
    assert.equal(
      (
        await client.query('select default_output_language from room where id=$1', [
          room,
        ])
      ).rows[0].default_output_language,
      null,
    )
  } finally {
    await client.query('rollback')
    await client.end()
  }
})
