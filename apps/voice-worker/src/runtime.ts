import { createDatabase } from '@babel/database'
import { createCredentialCipher } from '@babel/database/credentials'
import { runtimeOwnerActive } from '@babel/database/runtime-owners'
import { MediaPeers } from './media-peers.ts'
import { createControlServer } from './control-server.ts'
import { VoiceSources } from './voice-sources.ts'
import { SubtitleService } from './subtitle-service.ts'
import { createMediaNetwork } from './media-network.ts'

// Incarnation IDs come only from the supervisor's private IPC channel. Running
// this file directly never creates an unsupervised transport owner.
if (process.connected) {
  process.once('message', (message: unknown) => {
    if (
      typeof message !== 'object' ||
      message === null ||
      !('type' in message) ||
      message.type !== 'start' ||
      !('ownerId' in message) ||
      typeof message.ownerId !== 'string' ||
      !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/.test(message.ownerId)
    ) {
      process.exit(1)
    }
    void start(message.ownerId).catch(() => {
      console.error('Babel runtime could not start.')
      process.exit(1)
    })
  })
} else {
  console.error('Babel runtime requires its supervisor.')
  process.exitCode = 1
}

async function start(ownerId: string) {
  const databaseUrl = process.env.DATABASE_URL
  const secret = process.env.MEDIA_CONTROL_SECRET
  if (!databaseUrl || !secret) {
    throw new Error('Missing runtime configuration')
  }
  const port = Number(process.env.MEDIA_CONTROL_PORT ?? '3100')
  const host = process.env.MEDIA_CONTROL_HOST ?? '127.0.0.1'
  const network = createMediaNetwork(process.env)
  const database = createDatabase(databaseUrl, { queryTimeoutMs: 2_000 })
  const sourceDatabase = createDatabase(databaseUrl, { queryTimeoutMs: 2_000 })
  const subtitleDatabase = createDatabase(databaseUrl, { queryTimeoutMs: 2_000 })
  if (!(await runtimeOwnerActive(database.db, ownerId)) || !process.connected) {
    process.exit(1)
  }
  const peers = new MediaPeers(database.db, network, ownerId)
  let cipher = null
  try {
    cipher = createCredentialCipher(process.env.PROVIDER_ENCRYPTION_KEY ?? '')
  } catch {
    /* Media admission remains available without a source credential key. */
  }
  const subtitles = new SubtitleService(subtitleDatabase.db, cipher)
  const sources = new VoiceSources(sourceDatabase, peers, cipher, subtitles, ownerId)
  const server = createControlServer(peers, secret, sources, subtitles)
  let stopping = false
  async function stop() {
    if (stopping) {
      return
    }
    stopping = true
    // Also covers a parent crash: private IPC disconnect initiates shutdown.
    // A timeout may stop this process, but only its parent's exit event can
    // confirm the whole incarnation's closure in persistent storage.
    const deadline = setTimeout(() => process.exit(1), 6_000)
    deadline.unref()
    server.close()
    server.closeAllConnections()
    try {
      await sources.stop()
      await subtitles.stop()
      await peers.stop()
      await Promise.all([
        database.close(),
        sourceDatabase.close(),
        subtitleDatabase.close(),
      ])
    } catch {
      process.exitCode = 1
    } finally {
      clearTimeout(deadline)
      process.exit(process.exitCode ?? 0)
    }
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'disconnect']) {
    process.once(signal, () => void stop())
  }
  for (const storage of [database, sourceDatabase, subtitleDatabase]) {
    storage.pool.on('error', () => {
      process.exitCode = 1
      void stop()
    })
  }
  server.on('error', () => {
    console.error('Babel media control could not start.')
    process.exitCode = 1
    void stop()
  })
  server.listen(port, host, () => {
    const address = server.address()
    console.log(
      JSON.stringify({
        mediaControlListening: true,
        port: typeof address === 'object' && address ? address.port : port,
        voiceSourceControl: true,
        runtimePid: process.pid,
        ownerId,
      }),
    )
  })
}
