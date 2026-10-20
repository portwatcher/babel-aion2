import { listPublicListeners } from '@babel/database/listeners'
import { mapRevision } from '@babel/database/tactical-map'
import { useDatabase } from './database'
import { publicRoomConfiguration } from './room-configuration'

/**
 * What every member of one room receives during a sweep. Each event is read and
 * serialized once per room, not once per socket.
 */
export interface RoomView {
  players: string
  configuration: string
  map: string | null
}

async function readRoomView(roomId: string): Promise<RoomView> {
  const [players, configuration] = await Promise.all([
    listPublicListeners(useDatabase(), roomId),
    publicRoomConfiguration(undefined, roomId),
  ])
  // Only community rooms have a tactical map.
  const revision =
    configuration.room.number === undefined
      ? null
      : await mapRevision(useDatabase(), roomId)
  return {
    players: JSON.stringify({ type: 'players', players }),
    configuration: JSON.stringify({ type: 'configuration', configuration }),
    map: revision === null ? null : JSON.stringify({ type: 'map', revision }),
  }
}

/** A per-sweep cache: concurrent sockets in one room share a single read. */
export function createRoomViews() {
  const views = new Map<string, Promise<RoomView>>()
  return (roomId: string) => {
    let view = views.get(roomId)
    if (!view) {
      view = readRoomView(roomId)
      views.set(roomId, view)
    }
    return view
  }
}
