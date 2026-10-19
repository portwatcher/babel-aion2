import type { InjectionKey, Ref } from 'vue'
import type { PublicRoomConfiguration } from '@babel/contracts'

type RoomSession = ReturnType<typeof usePlayerSession> & {
  roomId: string
  configuration: Ref<PublicRoomConfiguration | null>
}
const roomSessionKey: InjectionKey<RoomSession> = Symbol('room-session')

export function provideRoomSession(
  configuration: Ref<PublicRoomConfiguration | null>,
  roomId: string,
) {
  const controller = {
    ...usePlayerSession(configuration, roomId),
    roomId,
    configuration,
  }
  provide(roomSessionKey, controller)
  return controller
}

export function useRoomSession() {
  const controller = inject(roomSessionKey)
  if (!controller) {
    throw new Error('Room session unavailable')
  }
  return controller
}
