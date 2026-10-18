import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import {
  createListenerService,
  isDeliveryAuthorized,
  listManagementListeners,
  listPublicListeners,
  unavailableListenerDelivery,
} from '../src/listeners/index.ts'
import { auditEvent, listenerSession, outputLanguage } from '../src/schema/rooms.ts'
import { controlledDelivery, listenerFixture } from './listener-fixture.ts'

test('unavailable transports persist JOINING across restart without granting command access or exposing credentials', async (t) => {
  const f = await listenerFixture(t, unavailableListenerDelivery)
  const entry = f.request()
  const session = await f.service.enter(f.roomId, entry.body, entry.credential)
  assert.equal(session.state, 'JOINING')
  assert.equal(await isDeliveryAuthorized(f.database.db, session), false)
  const restarted = createListenerService(f.database.db, unavailableListenerDelivery)
  assert.deepEqual(
    await restarted.restore(session.sessionId, entry.credential),
    session,
  )
  await assert.rejects(
    restarted.restore(session.sessionId, randomBytes(32).toString('base64url')),
    { code: 'INVALID_CREDENTIAL' },
  )
  assert.notEqual((await f.stored(session.sessionId)).credentialHash, entry.credential)
  assert.deepEqual(await listPublicListeners(f.database.db, f.roomId), [
    {
      sessionId: session.sessionId,
      nickname: entry.body.nickname,
      joinedAt: session.joinedAt,
      state: 'JOINING',
    },
  ])
})

test('cross-room replacement waits for every older delivery and rejects stale credentials and cleanup generations', async (t) => {
  const transport = controlledDelivery()
  const f = await listenerFixture(t, transport.delivery)
  const a = f.request('Cafe\u0301')
  const first = await f.service.enter(f.roomId, a.body, a.credential)
  assert.equal(first.state, 'ACTIVE')
  transport.heldMedia.add(first.sessionId)
  const b = f.request('Café')
  const second = await f.service.enter(f.otherRoomId, b.body, b.credential)
  assert.equal(second.state, 'JOINING')
  assert.equal(await isDeliveryAuthorized(f.database.db, first), false)
  const replaced = await f.service.restore(first.sessionId, a.credential)
  assert.equal(replaced.state, 'REPLACED')
  assert.equal(replaced.terminalReason, 'DUPLICATE_NICKNAME_REPLACED')
  assert.equal(
    (await listPublicListeners(f.database.db, f.roomId))[0]?.state,
    'DISCONNECTING',
  )
  await assert.rejects(f.service.heartbeat(first.sessionId, a.credential), {
    code: 'SESSION_ENDED',
  })

  const c = f.request('Café')
  const third = await f.service.enter(f.roomId, c.body, c.credential)
  assert.equal(third.nicknameGeneration, 3)
  assert.equal(third.state, 'JOINING', 'acknowledging B must not skip unconfirmed A')
  assert.equal(await isDeliveryAuthorized(f.database.db, third), false)
  transport.heldMedia.delete(first.sessionId)
  transport.heldSubtitles.add(first.sessionId)
  assert.equal(
    (await f.service.restore(third.sessionId, c.credential)).state,
    'JOINING',
  )
  transport.heldSubtitles.clear()
  assert.equal((await f.service.restore(third.sessionId, c.credential)).state, 'ACTIVE')
  assert.equal(await isDeliveryAuthorized(f.database.db, third), true)
  assert.equal(
    await f.service.remove({ ...third, nicknameGeneration: 2 }, f.actor),
    null,
  )
  await f.service.remove(first, f.actor)
  assert.equal(await isDeliveryAuthorized(f.database.db, third), true)
  assert.deepEqual(
    (await listPublicListeners(f.database.db, f.roomId)).map((p) => p.sessionId),
    [third.sessionId],
  )
})

test('concurrent entries serialize global generations and leave only the last generation authorized', async (t) => {
  const f = await listenerFixture(t, controlledDelivery().delivery)
  const entries = Array.from({ length: 8 }, () => f.request())
  const sessions = await Promise.all(
    entries.map((entry, i) =>
      f.service.enter(i % 2 ? f.otherRoomId : f.roomId, entry.body, entry.credential),
    ),
  )
  const restored = await Promise.all(
    sessions.map((session, i) =>
      f.service.restore(session.sessionId, entries[i]!.credential),
    ),
  )
  assert.deepEqual(
    restored.map((s) => s.nicknameGeneration).sort((a, b) => a - b),
    [1, 2, 3, 4, 5, 6, 7, 8],
  )
  const active = restored.filter((s) => s.state === 'ACTIVE')
  assert.equal(active.length, 1)
  assert.equal(active[0]?.nicknameGeneration, 8)
  for (const session of restored) {
    assert.equal(
      await isDeliveryAuthorized(f.database.db, session),
      session.nicknameGeneration === 8,
    )
  }
})

test('entry retries return their original session and never replace a newer entry or accept a changed request', async (t) => {
  const f = await listenerFixture(t, controlledDelivery().delivery)
  const a = f.request()
  const firstResults = await Promise.all(
    Array.from({ length: 5 }, () => f.service.enter(f.roomId, a.body, a.credential)),
  )
  const first = firstResults[0]!
  assert.ok(
    firstResults.every(
      (s) => s.sessionId === first.sessionId && s.nicknameGeneration === 1,
    ),
  )
  const b = f.request()
  const second = await f.service.enter(f.roomId, b.body, b.credential)
  const retry = await f.service.enter(f.roomId, a.body, a.credential)
  assert.equal(retry.sessionId, first.sessionId)
  assert.equal(retry.state, 'REPLACED')
  assert.equal(await isDeliveryAuthorized(f.database.db, second), true)
  await assert.rejects(
    f.service.enter(
      f.roomId,
      { ...a.body, nickname: `${a.body.nickname}x` },
      a.credential,
    ),
    { code: 'ENTRY_CONFLICT' },
  )
  await assert.rejects(f.service.enter(f.roomId, a.body, b.credential), {
    code: 'INVALID_CREDENTIAL',
  })
  await assert.rejects(
    f.service.enter(f.roomId, f.request('other').body, a.credential),
    { code: 'ENTRY_CONFLICT' },
  )
})

test('language changes increment subscription versions without changing identity or revoking audio', async (t) => {
  const transport = controlledDelivery()
  const f = await listenerFixture(t, transport.delivery)
  await f.database.db.insert(outputLanguage).values({
    code: f.language,
    name: 'Local test only',
    enabled: true,
    pathValidatedAt: new Date(),
  })
  const entry = f.request()
  const initial = await f.service.enter(f.roomId, entry.body, entry.credential)
  const changed = await f.service.changeLanguage(
    initial.sessionId,
    entry.credential,
    f.language,
  )
  assert.equal(changed.sessionId, initial.sessionId)
  assert.equal(changed.nicknameGeneration, initial.nicknameGeneration)
  assert.equal(changed.outputLanguage, f.language)
  assert.equal(changed.subscriptionVersion, 1)
  assert.equal(
    (await f.service.changeLanguage(initial.sessionId, entry.credential, f.language))
      .subscriptionVersion,
    1,
  )
  assert.equal(
    (await f.service.enter(f.roomId, entry.body, entry.credential)).outputLanguage,
    f.language,
  )
  await f.database.db
    .update(outputLanguage)
    .set({ enabled: false })
    .where(eq(outputLanguage.code, f.language))
  await assert.rejects(
    f.service.changeLanguage(initial.sessionId, entry.credential, f.language),
    { code: 'LANGUAGE_UNAVAILABLE' },
  )
  const disabled = f.request('disabled', f.language)
  await assert.rejects(f.service.enter(f.roomId, disabled.body, disabled.credential), {
    code: 'LANGUAGE_UNAVAILABLE',
  })
  const silent = await f.service.changeLanguage(
    initial.sessionId,
    entry.credential,
    null,
  )
  assert.equal(silent.subscriptionVersion, 2)
  assert.equal(await isDeliveryAuthorized(f.database.db, silent), true)
  assert.deepEqual(
    transport.calls,
    [],
    'subscription changes do not touch transport revocation',
  )
})

test('manual removal audits once and reconciliation retains uncertain connections until shutdown is confirmed', async (t) => {
  const transport = controlledDelivery()
  const f = await listenerFixture(t, transport.delivery)
  const entry = f.request()
  const session = await f.service.enter(f.roomId, entry.body, entry.credential)
  transport.heldMedia.add(session.sessionId)
  const removed = await f.service.remove(session, f.actor)
  assert.equal(removed?.terminalReason, 'ADMINISTRATOR_REMOVED')
  assert.equal(await isDeliveryAuthorized(f.database.db, session), false)
  assert.equal(
    (await listManagementListeners(f.database.db, f.roomId))[0]?.state,
    'DISCONNECTING',
  )
  await f.service.remove(session, f.actor)
  const audit = await f.database.db
    .select()
    .from(auditEvent)
    .where(eq(auditEvent.actorSubject, f.actor))
  assert.equal(audit.length, 1)
  assert.deepEqual(audit[0]?.metadata, {
    nicknameGeneration: 1,
    reason: 'ADMINISTRATOR_REMOVED',
  })
  transport.heldMedia.clear()
  await f.service.reconcile(new Date(0))
  assert.deepEqual(await listPublicListeners(f.database.db, f.roomId), [])
  assert.equal(
    (await f.service.restore(session.sessionId, entry.credential)).state,
    'REMOVED',
  )

  const freshEntry = f.request('heartbeat')
  const fresh = await f.service.enter(f.roomId, freshEntry.body, freshEntry.credential)
  const staleEntry = f.request('stale')
  const stale = await f.service.enter(f.roomId, staleEntry.body, staleEntry.credential)
  await f.database.db
    .update(listenerSession)
    .set({ lastSeenAt: new Date(0) })
    .where(eq(listenerSession.id, stale.sessionId))
  await f.service.heartbeat(fresh.sessionId, freshEntry.credential)
  transport.heldMedia.add(stale.sessionId)
  await f.service.reconcile(new Date(Date.now() - 60_000))
  assert.equal(await isDeliveryAuthorized(f.database.db, fresh), true)
  assert.equal(
    (await f.service.restore(stale.sessionId, staleEntry.credential)).terminalReason,
    'CONNECTION_EXPIRED',
  )
  assert.equal(
    (await listPublicListeners(f.database.db, f.roomId)).find(
      (p) => p.sessionId === stale.sessionId,
    )?.state,
    'DISCONNECTING',
  )
})
