import { receiveRuntimeOwner } from '@babel/processes'
import { startTelemetry, stopTelemetry } from '@babel/telemetry'
import { createDatabase, databasePoolSize } from '@babel/database'
import { createCredentialCipher } from '@babel/database/credentials'
import {
  readVoiceScaleLoad,
  runtimeOwnerActive,
  setRuntimeOwnerControlUrl,
} from '@babel/database/runtime-owners'
import { MediaPeers } from './media-peers.ts'
import { createControlServer } from './control-server.ts'
import { RemoteRoomAudio } from './remote-room-audio.ts'
import { RoomAudioHub } from './room-audio-hub.ts'
import { VoiceSources } from './voice-sources.ts'
import { SubtitleService } from './subtitle-service.ts'
import { createMediaNetwork } from './media-network.ts'
import { PACKET_DURATIONS, type PacketDuration } from './room-audio.ts'
import {
  computeVoiceScaleMetrics,
  parseBurstScalePolicy,
  parseFanoutOnly,
} from './scale-policy.ts'

/** Original-audio packet duration; longer packets cut per-listener packet work. */
function packetDuration(value: string | undefined): PacketDuration {
  const duration = PACKET_DURATIONS.find((item) => String(item) === (value || '60'))
  if (!duration) {
    throw new Error('Invalid Opus packet duration')
  }
  return duration
}

/** Optional private URL advertised in PostgreSQL for multi-replica worker routing. */
function advertisedControlUrl(boundPort: number) {
  const explicit = process.env.MEDIA_CONTROL_ADVERTISE_URL?.trim()
  const podIp = process.env.BABEL_RUNTIME_POD_IP?.trim()
  const raw =
    explicit ||
    (podIp ? `http://${podIp.includes(':') ? `[${podIp}]` : podIp}:${boundPort}` : '')
  if (!raw) {
    return null
  }
  const parsed = new URL(raw)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Invalid advertised control URL')
  }
  return parsed.origin
}

try {
  await start(await receiveRuntimeOwner())
} catch {
  console.error('Babel runtime could not start.')
  process.exit(1)
}

async function start(ownerId: string) {
  const databaseUrl = process.env.DATABASE_URL
  const secret = process.env.MEDIA_CONTROL_SECRET
  if (!databaseUrl || !secret) {
    throw new Error('Missing runtime configuration')
  }
  const port = Number(process.env.MEDIA_CONTROL_PORT ?? '3100')
  const host = process.env.MEDIA_CONTROL_HOST ?? '127.0.0.1'
  const fanoutOnly = parseFanoutOnly(process.env.MEDIA_FANOUT_ONLY)
  const scalePolicy = parseBurstScalePolicy(process.env)
  const network = createMediaNetwork(process.env)
  startTelemetry('babel-voice')
  // Source ownership holds a dedicated session while queries continue. Preserve
  // at least one additional slot and keep provider work out of the media pool.
  // Fan-out-only burst replicas skip voice sources and subtitles to stay at one pool.
  const storage = {
    queryTimeoutMs: 2_000,
    maxConnections: databasePoolSize(process.env.DATABASE_POOL_MAX, 2),
  }
  const database = createDatabase(databaseUrl, storage)
  const sourceDatabase = fanoutOnly ? null : createDatabase(databaseUrl, storage)
  const subtitleDatabase = fanoutOnly ? null : createDatabase(databaseUrl, storage)
  if (!(await runtimeOwnerActive(database.db, ownerId)) || !process.connected) {
    process.exit(1)
  }
  const threads = Number(process.env.MEDIA_WORKER_THREADS || '2')
  if (!Number.isSafeInteger(threads) || threads < 0 || threads > 16) {
    throw new Error('Invalid media worker thread count')
  }
  // A lost media thread took its peers with it; restart through the supervisor.
  const peers = new MediaPeers(database.db, network, ownerId, {
    threads,
    failed: () => {
      process.exitCode = 1
      void stop()
    },
  })
  let cipher = null
  if (!fanoutOnly) {
    try {
      cipher = createCredentialCipher(process.env.PROVIDER_ENCRYPTION_KEY ?? '')
    } catch {
      /* Media admission remains available without a source credential key. */
    }
  }
  const audioHub = fanoutOnly ? undefined : new RoomAudioHub()
  const subtitles = subtitleDatabase
    ? new SubtitleService(subtitleDatabase.db, cipher, ownerId)
    : null
  const sources =
    sourceDatabase && subtitles
      ? new VoiceSources(
          sourceDatabase,
          peers,
          cipher,
          subtitles,
          ownerId,
          packetDuration(process.env.MEDIA_OPUS_FRAME_MS),
          audioHub,
        )
      : null
  const remoteAudio = new RemoteRoomAudio(
    database.db,
    secret,
    ownerId,
    peers,
    (roomId) => sources?.ownsRoom(roomId) ?? false,
  )
  const server = createControlServer(peers, secret, sources, subtitles, audioHub, () =>
    readVoiceScaleLoad(database.db).then((load) =>
      computeVoiceScaleMetrics(load, scalePolicy),
    ),
  )
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
      await remoteAudio.stop()
      audioHub?.close()
      await sources?.stop()
      await subtitles?.stop()
      await peers.stop()
      await Promise.all(
        [database, sourceDatabase, subtitleDatabase]
          .filter((item): item is ReturnType<typeof createDatabase> => item !== null)
          .map((item) => item.close()),
      )
      await stopTelemetry()
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
  for (const item of [database, sourceDatabase, subtitleDatabase]) {
    item?.pool.on('error', () => {
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
    const boundPort = typeof address === 'object' && address ? address.port : port
    void (async () => {
      try {
        const controlUrl = advertisedControlUrl(boundPort)
        if (fanoutOnly && !controlUrl) {
          throw new Error('Fan-out worker requires an advertised control URL')
        }
        if (controlUrl) {
          await setRuntimeOwnerControlUrl(database.db, ownerId, controlUrl, {
            fanoutOnly,
          })
        }
        console.log(
          JSON.stringify({
            mediaControlListening: true,
            port: boundPort,
            voiceSourceControl: !fanoutOnly,
            fanoutOnly,
            runtimePid: process.pid,
            ownerId,
          }),
        )
      } catch {
        console.error('Babel media control registration failed.')
        process.exitCode = 1
        void stop()
      }
    })()
  })
}
