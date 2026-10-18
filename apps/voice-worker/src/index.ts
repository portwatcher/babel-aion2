import { createDatabase } from '@babel/database'
import { createCredentialCipher } from '@babel/database/credentials'
import { MediaPeers } from './media-peers.ts'
import { createControlServer } from './control-server.ts'
import { VoiceSources } from './voice-sources.ts'

const databaseUrl = process.env.DATABASE_URL
const secret = process.env.MEDIA_CONTROL_SECRET
const port = Number(process.env.MEDIA_CONTROL_PORT ?? '3100')
const host = process.env.MEDIA_CONTROL_HOST ?? '127.0.0.1'

if (!databaseUrl || !secret) {
  console.log(
    'Babel worker: STOPPED — configure database and private media control before starting.',
  )
} else if (secret.length < 32 || !Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('Babel worker configuration is invalid.')
  process.exitCode = 1
} else {
  const database = createDatabase(databaseUrl)
  const sourceDatabase = createDatabase(databaseUrl, { queryTimeoutMs: 2_000 })
  // Public ICE/TURN configuration remains a deployment gate. No external STUN
  // service is contacted implicitly, and no production connectivity is claimed.
  const peers = new MediaPeers(database.db, { iceServers: [], iceUseIpv6: false })
  let cipher = null
  try {
    cipher = createCredentialCipher(process.env.PROVIDER_ENCRYPTION_KEY ?? '')
  } catch {
    /* Media admission remains available without a source credential key. */
  }
  const sources = new VoiceSources(sourceDatabase, peers, cipher)
  const server = createControlServer(peers, secret, sources)
  server.listen(port, host, () => {
    const address = server.address()
    console.log(
      JSON.stringify({
        mediaControlListening: true,
        port: typeof address === 'object' && address ? address.port : port,
        voiceSourceControl: true,
      }),
    )
  })
  let stopping = false
  async function stop() {
    if (stopping) {
      return
    }
    stopping = true
    server.close()
    await sources.stop()
    await sourceDatabase.close()
    await peers.stop()
    await database.close()
  }
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => void stop())
  }
  server.on('error', () => {
    console.error('Babel media control could not start.')
    process.exitCode = 1
    void stop()
  })
}
