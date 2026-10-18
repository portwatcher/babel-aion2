import type { PublicRoomConfiguration } from '@babel/contracts'

export default defineEventHandler((event): PublicRoomConfiguration => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  // No adapter is implemented, so no processing path can be advertised yet.
  return {
    room: { id: 'default', name: 'AION2 深渊站', audioState: 'UNCONFIGURED' },
    outputLanguages: [],
    defaultOutputLanguage: null,
    entryAvailable: false,
  }
})
