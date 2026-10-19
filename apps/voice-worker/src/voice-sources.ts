import { performance } from 'node:perf_hooks'
import type { VoiceSourceStatus } from '@babel/contracts'
import type { createDatabase } from '@babel/database'
import type { CredentialCipher } from '@babel/database/credentials'
import {
  claimVoiceSource,
  readVoiceSourceGroups,
  voiceSourceConfigured,
  VoiceSourceOwnershipError,
  type VoiceSourceConfiguration,
} from '@babel/database/voice-sources'
import { DiscordSource } from './discord-source.ts'
import { GuildBroadcast } from './guild-broadcast.ts'
import type { MediaPeers } from './media-peers.ts'
import type { SubtitleService } from './subtitle-service.ts'

interface Source {
  configuration: VoiceSourceConfiguration
  lease: Awaited<ReturnType<typeof claimVoiceSource>> | null
  discord: DiscordSource | null
  broadcast: GuildBroadcast | null
  rooms: VoiceSourceConfiguration[]
  starting: Promise<void> | null
  closing: boolean
  closingTask: Promise<void> | null
  validUntil: number
}

export class VoiceSources {
  private readonly sources = new Map<string, Source>()
  private readonly failures = new Map<
    string,
    {
      generation: number
      retryAt: number
      reason: VoiceSourceStatus['reason']
    }
  >()
  private readonly configurations = new Map<string, VoiceSourceConfiguration>()
  private readonly sourceIds = new Map<string, string>()
  private readonly timer: ReturnType<typeof setInterval>
  private checking: Promise<void> | null = null
  private stopped = false

  constructor(
    private readonly database: ReturnType<typeof createDatabase>,
    private readonly peers: MediaPeers,
    private readonly cipher: CredentialCipher | null,
    private readonly subtitles: SubtitleService,
    private readonly ownerId: string,
  ) {
    this.timer = setInterval(() => this.check(), 500)
    this.timer.unref()
    this.check()
  }

  status(roomId: string): VoiceSourceStatus {
    const sourceId = this.sourceIds.get(roomId) ?? roomId
    const source = this.sources.get(sourceId)
    const configuration = this.configurations.get(roomId)
    const failure = this.failures.get(sourceId)
    return {
      roomId,
      sourceGeneration: configuration?.sourceGeneration ?? 0,
      state:
        configuration?.stopped !== false
          ? 'STOPPED'
          : source
            ? source.closing
              ? 'STOPPING'
              : source.discord?.ready() && performance.now() < source.validUntil
                ? 'LISTENING'
                : 'CONNECTING'
            : 'UNAVAILABLE',
      reason: failure?.reason ?? null,
      speakers: source?.closing ? [] : (source?.discord?.status() ?? []),
    }
  }

  private check() {
    if (this.checking || this.stopped) {
      return
    }
    this.checking = this.reconcile()
      .catch(() => {
        for (const source of this.sources.values()) {
          this.fail(source, 'STORAGE')
        }
      })
      .finally(() => {
        this.checking = null
      })
  }

  private async reconcile() {
    const groups = await readVoiceSourceGroups(this.database.db)
    if (this.stopped) {
      return
    }
    const roomIds = new Set(groups.map((group) => group.configuration.id))
    this.configurations.clear()
    this.sourceIds.clear()
    for (const group of groups) {
      for (const room of group.rooms) {
        this.configurations.set(room.id, room)
        this.sourceIds.set(room.id, group.configuration.id)
      }
    }
    for (const [id, source] of this.sources) {
      if (!roomIds.has(id)) {
        void this.close(source).catch(() => {})
      }
    }
    for (const { configuration, rooms } of groups) {
      const source = this.sources.get(configuration.id)
      if (source) {
        if (
          source.closing ||
          configuration.stopped ||
          (rooms.length === 1 &&
            configuration.sourceGeneration > source.configuration.sourceGeneration) ||
          configuration.discordVoiceChannelId !==
            source.configuration.discordVoiceChannelId ||
          configuration.captureMode !== source.configuration.captureMode ||
          JSON.stringify(configuration.commanderIds) !==
            JSON.stringify(source.configuration.commanderIds) ||
          configuration.encryptedDiscordCredential !==
            source.configuration.encryptedDiscordCredential
        ) {
          void this.close(source).catch(() => {})
        } else {
          // Publication fails closed when configuration reads stop completing.
          source.validUntil = performance.now() + 1_500
          source.rooms = rooms
          await source.broadcast?.reconcile(rooms)
        }
        continue
      }
      if (configuration.stopped) {
        this.failures.delete(configuration.id)
        continue
      }
      const failure = this.failures.get(configuration.id)
      if (
        failure?.generation === configuration.sourceGeneration &&
        failure.retryAt > Date.now()
      ) {
        continue
      }
      const next: Source = {
        configuration,
        lease: null,
        discord: null,
        broadcast: null,
        rooms,
        starting: null,
        closing: false,
        closingTask: null,
        validUntil: performance.now() + 1_500,
      }
      this.sources.set(configuration.id, next)
      this.failures.delete(configuration.id)
      next.starting = this.start(next).catch((error: unknown) => {
        this.fail(
          next,
          error instanceof VoiceSourceOwnershipError
            ? 'OWNERSHIP'
            : !this.cipher || !voiceSourceConfigured(next.configuration)
              ? 'CONFIGURATION'
              : 'DISCORD',
        )
      })
    }
  }

  private fail(source: Source, reason: VoiceSourceStatus['reason']) {
    if (source.closing) {
      return
    }
    this.failures.set(source.configuration.id, {
      generation: source.configuration.sourceGeneration,
      retryAt:
        Date.now() +
        (reason === 'OWNERSHIP' || reason === 'CONFIGURATION' ? 30_000 : 5_000),
      reason,
    })
    void this.close(source).catch(() => {})
  }

  private async start(source: Source) {
    const configuration = source.configuration
    if (
      !this.cipher ||
      !configuration.encryptedDiscordCredential ||
      !voiceSourceConfigured(configuration)
    ) {
      throw new Error('Voice source configuration unavailable')
    }
    const token = this.cipher.decrypt(
      configuration.encryptedDiscordCredential,
      `room:${configuration.id}:discord`,
    )
    // Resolve authenticated bot identity before acquiring exclusive guild
    // control. Never infer it from the secret's encoding or print the response.
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(5_000),
      redirect: 'error',
    })
    if (!response.ok) {
      throw new Error('Discord identity unavailable')
    }
    const identity: unknown = await response.json()
    if (
      typeof identity !== 'object' ||
      identity === null ||
      !('id' in identity) ||
      typeof identity.id !== 'string' ||
      !/^[1-9][0-9]{16,19}$/.test(identity.id) ||
      !('bot' in identity) ||
      identity.bot !== true
    ) {
      throw new Error('Discord bot identity required')
    }
    if (source.closing) {
      return
    }
    source.lease = await claimVoiceSource(
      this.database.db,
      this.database.pool,
      configuration,
      identity.id,
      this.ownerId,
      () => this.fail(source, 'OWNERSHIP'),
    )
    source.configuration = source.lease.source
    if (source.closing || !source.lease.valid()) {
      return
    }
    const allowed = () =>
      this.sources.get(configuration.id) === source &&
      !source.closing &&
      source.lease?.valid() === true &&
      performance.now() < source.validUntil &&
      source.discord?.ready() === true
    source.broadcast = new GuildBroadcast(allowed, this.peers, this.subtitles, () =>
      this.fail(source, 'DISCORD'),
    )
    await source.broadcast.reconcile(
      source.rooms.map((room) =>
        room.id === source.configuration.id
          ? { ...room, sourceGeneration: source.configuration.sourceGeneration }
          : room,
      ),
    )
    if (source.closing) {
      return
    }
    source.discord = new DiscordSource(
      source.configuration,
      (id, pcm, name) => {
        source.broadcast?.receive(id, name, pcm)
      },
      (id) => {
        source.broadcast?.remove(id)
      },
      () => this.fail(source, 'DISCORD'),
    )
    await source.discord.open(token)
  }

  private close(source: Source): Promise<void> {
    source.closing = true
    if (source.closingTask) {
      return source.closingTask
    }
    const broadcastClosed = source.broadcast?.close()
    source.closingTask = (async () => {
      // Retire browser playout immediately, independently of Discord shutdown.
      await Promise.all([broadcastClosed, source.discord?.close()])
      await source.starting
      await source.broadcast?.close()
      await source.discord?.close()
      // Closing old peers discards browser decoder/jitter state as well as the
      // worker's PCM queues. New negotiation is fenced by the room epoch.
      await source.lease?.close()
      if (this.sources.get(source.configuration.id) === source) {
        this.sources.delete(source.configuration.id)
      }
    })().finally(() => {
      source.closingTask = null
    })
    return source.closingTask
  }

  async stop() {
    this.stopped = true
    clearInterval(this.timer)
    await this.checking
    await Promise.allSettled(
      [...this.sources.values()].map((source) => this.close(source)),
    )
    // Any unconfirmed close retains its durable receipt, preventing takeover.
    await Promise.all(
      [...this.sources.values()].map((source) => source.lease?.abandon()),
    )
  }
}
