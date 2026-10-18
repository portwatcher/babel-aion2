import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import type { TestContext } from 'node:test'
import { and, eq, inArray, like } from 'drizzle-orm'
import { createDatabase } from '../src/client.ts'
import { createListenerService, type ListenerDelivery } from '../src/listeners/index.ts'
import {
  auditEvent,
  listenerSession,
  nickname,
  outputLanguage,
  room,
} from '../src/schema/rooms.ts'

// This port acknowledges simulated shutdown only. Database assertions never
// claim Discord, media or WebSocket revocation has been tested here.
export function controlledDelivery() {
  const stopped = new Set<string>()
  const heldMedia = new Set<string>()
  const heldSubtitles = new Set<string>()
  const calls: string[] = []
  const delivery: ListenerDelivery = {
    ready: async () => true,
    revokeSubtitles: async (reference) => {
      calls.push(`subtitles:${reference.sessionId}:${reference.nicknameGeneration}`)
      return !heldSubtitles.has(reference.sessionId)
    },
    revokeMedia: async (reference) => {
      calls.push(`media:${reference.sessionId}:${reference.nicknameGeneration}`)
      if (heldMedia.has(reference.sessionId)) {
        return false
      }
      stopped.add(reference.sessionId)
      return true
    },
  }
  return { delivery, heldMedia, heldSubtitles, calls, stopped }
}

export async function listenerFixture(t: TestContext, delivery: ListenerDelivery) {
  assert.ok(process.env.DATABASE_URL, 'Use the disposable PostgreSQL database')
  const database = createDatabase(process.env.DATABASE_URL)
  const prefix = randomUUID().slice(0, 8)
  const rooms = [randomUUID(), randomUUID()]
  const roomId = rooms[0]!
  const otherRoomId = rooms[1]!
  const language = `qaa-x-${prefix}`
  await database.db
    .insert(room)
    .values(rooms.map((id) => ({ id, name: `test-${prefix}` })))
  t.after(async () => {
    try {
      await database.db
        .delete(auditEvent)
        .where(eq(auditEvent.actorSubject, `test:${prefix}`))
      await database.db
        .delete(listenerSession)
        .where(inArray(listenerSession.roomId, rooms))
      await database.db.delete(nickname).where(like(nickname.key, `${prefix}-%`))
      await database.db.delete(outputLanguage).where(eq(outputLanguage.code, language))
      await database.db.delete(room).where(inArray(room.id, rooms))
    } finally {
      await database.close()
    }
  })
  return {
    database,
    roomId,
    otherRoomId,
    language,
    actor: `test:${prefix}`,
    service: createListenerService(database.db, delivery),
    request(name = '玩家', outputLanguage: string | null = null) {
      return {
        credential: randomBytes(32).toString('base64url'),
        body: {
          nickname: `${prefix}-${name}`,
          outputLanguage,
          requestId: randomUUID(),
        },
      }
    },
    async stored(id: string) {
      const [record] = await database.db
        .select()
        .from(listenerSession)
        .where(and(eq(listenerSession.id, id), inArray(listenerSession.roomId, rooms)))
      assert.ok(record)
      return record
    },
  }
}
