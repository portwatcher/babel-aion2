// Test-process routing only: production keeps fixed official destinations and
// has no alternate endpoint setting. Exercise actual local HTTP/WS transport.
export function routeProviderNetwork(origin) {
  const local = new URL(origin)
  if (local.hostname !== '127.0.0.1' || local.protocol !== 'http:') {
    throw new Error('Provider fixture must listen on loopback')
  }
  const networkFetch = globalThis.fetch
  const NetworkWebSocket = globalThis.WebSocket
  globalThis.fetch = (input, options) => {
    const url = input instanceof Request ? input.url : String(input)
    if (
      [
        'https://api.deepl.com/v2/translate',
        'https://api-free.deepl.com/v2/translate',
      ].includes(url)
    ) {
      return networkFetch(`${origin}/v2/translate`, options)
    }
    return networkFetch(input, options)
  }
  globalThis.WebSocket = class extends NetworkWebSocket {
    constructor(url, protocols) {
      super(
        String(url) === 'wss://stt-rt.soniox.com/transcribe-websocket'
          ? `${origin.replace('http:', 'ws:')}/transcribe-websocket`
          : url,
        protocols,
      )
    }
  }
  return () => {
    globalThis.fetch = networkFetch
    globalThis.WebSocket = NetworkWebSocket
  }
}

if (process.env.BABEL_TEST_PROVIDER_ORIGIN) {
  routeProviderNetwork(process.env.BABEL_TEST_PROVIDER_ORIGIN)
}
