import type { NodeOptions } from 'crossws/adapters/node'

// Reject oversized player frames while parsing, before ws buffers its 100 MiB default.
const maximumFrameBytes = 2_048

export default defineNitroPlugin((nitro) => {
  const options = nitro.h3App.options
  const websocket: NodeOptions = {
    ...options.websocket,
    serverOptions: { maxPayload: maximumFrameBytes },
  }
  options.websocket = websocket
})
