import type { CharacterProfile, ListenerReference } from '@babel/contracts'
import { and, eq } from 'drizzle-orm'
import type { Database } from '../client.ts'
import { listenerSession } from '../schema/rooms.ts'
import { disbandEmptyCommunityRooms } from '../room-lifecycle.ts'
import { activateCurrent, prepareEntry } from './entry.ts'
import {
  confirmDeliveryStopped,
  heartbeat,
  inactiveListeners,
  pendingRemovals,
  readAuthenticated,
  requestRemoval,
  updateSubscription,
} from './lifecycle.ts'
import { snapshot, type ListenerRecord } from './model.ts'
export { ListenerError } from './model.ts'
export {
  authorizeMediaSession,
  openMediaConnection,
  mediaConnectionAuthorized,
  earlierMediaConnectionsStopped,
  closeMediaConnection,
  mediaConnectionsStopped,
} from './media-connections.ts'
export {
  openPlayerConnection,
  readPlayerConnection,
  renewPlayerConnection,
  closePlayerConnection,
  subtitleConnectionsStopped,
} from './connections.ts'
export {
  isDeliveryAuthorized,
  listManagementListeners,
  listPublicListeners,
} from './queries.ts'

export interface ListenerDelivery {
  // This is readiness for authorizing connections, not audio/provider health.
  ready(): Promise<boolean>
  // true means active delivery stopped AND credentials/reconnects are denied.
  // Implementations must scope every delayed operation to this exact reference.
  revokeSubtitles(reference: ListenerReference): Promise<boolean>
  revokeMedia(reference: ListenerReference): Promise<boolean>
}

// Until both real transport implementations exist, no listener is authorized.
export const unavailableListenerDelivery: ListenerDelivery = {
  ready: async () => false,
  revokeSubtitles: async () => false,
  revokeMedia: async () => false,
}

export function createListenerService(db: Database, delivery: ListenerDelivery) {
  async function stop(record: ListenerRecord) {
    const reference = {
      sessionId: record.id,
      nicknameGeneration: record.nicknameGeneration,
    }
    const results = await Promise.allSettled([
      delivery.revokeSubtitles(reference),
      delivery.revokeMedia(reference),
    ])
    if (
      results.every((result) => result.status === 'fulfilled' && result.value === true)
    ) {
      await confirmDeliveryStopped(db, reference)
    }
  }

  async function advance(record: ListenerRecord) {
    if (record.state === 'JOINING') {
      for (const pending of await pendingRemovals(db, record.nicknameKey)) {
        await stop(pending)
      }
      // An unavailable or failed transport must never authorize even a first entry.
      if (await delivery.ready().catch(() => false)) {
        await activateCurrent(db, record.id, record.nicknameGeneration)
      }
    }
    const [fresh] = await db
      .select()
      .from(listenerSession)
      .where(eq(listenerSession.id, record.id))
    return snapshot(fresh ?? record)
  }

  return {
    async enter(
      roomId: string,
      request: unknown,
      credential: string,
      character?: CharacterProfile,
    ) {
      return advance(await prepareEntry(db, roomId, request, credential, character))
    },
    async restore(id: string, credential: string) {
      return advance(await readAuthenticated(db, id, credential))
    },
    async heartbeat(id: string, credential: string) {
      return advance(await heartbeat(db, id, credential))
    },
    async changeLanguage(id: string, credential: string, code: string | null) {
      return snapshot(await updateSubscription(db, id, credential, code))
    },
    async leave(id: string, credential: string) {
      const record = await readAuthenticated(db, id, credential)
      const removed = await requestRemoval(
        db,
        {
          sessionId: id,
          nicknameGeneration: record.nicknameGeneration,
        },
        'PLAYER_LEFT',
      )
      if (removed?.revokedAt) {
        await stop(removed)
      }
      return snapshot(removed ?? record)
    },
    async remove(reference: ListenerReference, actorSubject: string) {
      const removed = await requestRemoval(
        db,
        reference,
        'ADMINISTRATOR_REMOVED',
        actorSubject,
      )
      if (removed?.revokedAt) {
        await stop(removed)
      }
      return removed ? snapshot(removed) : null
    },
    async reconcile(inactiveBefore: Date) {
      for (const record of await inactiveListeners(db, inactiveBefore)) {
        await requestRemoval(
          db,
          {
            sessionId: record.id,
            nicknameGeneration: record.nicknameGeneration,
          },
          'CONNECTION_EXPIRED',
          undefined,
          inactiveBefore,
        )
      }
      for (const pending of await pendingRemovals(db)) {
        await stop(pending)
      }
      const waiting = await db
        .select()
        .from(listenerSession)
        .where(and(eq(listenerSession.state, 'JOINING')))
      for (const record of waiting) {
        await advance(record)
      }
      await disbandEmptyCommunityRooms(db)
    },
  }
}
