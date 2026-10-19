import http from 'node:http'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'

// Test-process routing only. Exercise the real ws handshake, framing, headers
// and loopback sockets without introducing a production endpoint override.
export function routeProviderNetwork(origin) {
  const local = new URL(origin)
  if (local.hostname !== '127.0.0.1' || local.protocol !== 'http:') {
    throw new Error('Provider fixture must listen on loopback')
  }
  const request = https.request
  https.request = function (options, callback) {
    if (
      options &&
      typeof options === 'object' &&
      (options.hostname ?? options.host) === 'api.openai.com'
    ) {
      return http.request(
        {
          ...options,
          protocol: 'http:',
          hostname: local.hostname,
          host: local.hostname,
          port: local.port,
          agent: undefined,
          createConnection: undefined,
          defaultPort: Number(local.port),
        },
        callback,
      )
    }
    return request.call(this, options, callback)
  }
  syncBuiltinESMExports()
  return () => {
    https.request = request
    syncBuiltinESMExports()
  }
}
if (process.env.BABEL_TEST_PROVIDER_ORIGIN) {
  routeProviderNetwork(process.env.BABEL_TEST_PROVIDER_ORIGIN)
}
