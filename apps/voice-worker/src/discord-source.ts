import { once } from 'node:events'
import { ChannelType, Client, GatewayIntentBits, PermissionFlagsBits } from 'discord.js'
import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
  type AudioReceiveStream,
  type VoiceConnection,
} from '@discordjs/voice'
import opus from '@discordjs/opus'
import type { VoiceSourceConfiguration } from '@babel/database/voice-sources'

interface Speaker {
  id: string
  displayName: string
  receivedFrames: number
  stream: AudioReceiveStream
}

export class DiscordSource {
  private readonly client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  })
  private connection: VoiceConnection | null = null
  private readonly speakers = new Map<string, Speaker>()
  private closed = false
  private connected = false
  private opening: Promise<void> | null = null

  constructor(
    private readonly configuration: VoiceSourceConfiguration,
    private readonly frame: (id: string, pcm: Buffer, displayName: string) => void,
    private readonly removed: (id: string) => void,
    private readonly failed: () => void,
  ) {
    this.client.on('error', () => this.fail())
    this.client.on('shardDisconnect', () => this.fail())
    this.client.on('voiceStateUpdate', (_, after) => {
      if (
        after.id === this.client.user?.id &&
        after.channelId !== configuration.discordVoiceChannelId
      ) {
        this.fail()
      }
      if (after.channelId !== configuration.discordVoiceChannelId) {
        this.remove(after.id)
      }
      const speaker = this.speakers.get(after.id)
      if (speaker && after.member) {
        speaker.displayName = after.member.displayName
      }
    })
  }

  ready() {
    return this.connected && !this.closed
  }
  status() {
    return [...this.speakers.values()].map(({ id, displayName, receivedFrames }) => ({
      id,
      displayName,
      receivedFrames,
    }))
  }

  open(token: string) {
    this.opening = this.connect(token)
    return this.opening
  }

  private async connect(token: string) {
    const ready = once(this.client, 'clientReady', {
      signal: AbortSignal.timeout(30_000),
    })
    // Attach a rejection handler before login can fail, avoiding a detached
    // timeout rejection when a credential is refused.
    void ready.catch(() => {})
    await Promise.all([this.client.login(token), ready])
    if (this.closed) {
      return
    }
    const guildId = this.configuration.discordGuildId
    const channelId = this.configuration.discordVoiceChannelId
    if (!guildId || !channelId) {
      throw new Error('Discord source is incomplete')
    }
    const guild = await this.client.guilds.fetch(guildId)
    const channel = await guild.channels.fetch(channelId)
    const member = await guild.members.fetchMe()
    if (
      channel?.type !== ChannelType.GuildVoice ||
      !channel
        .permissionsFor(member)
        ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect])
    ) {
      throw new Error('Discord voice access unavailable')
    }
    if (this.closed) {
      return
    }
    const connection = joinVoiceChannel({
      guildId,
      channelId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
      daveEncryption: true,
    })
    this.connection = connection
    connection.on('error', () => this.fail())
    connection.on('stateChange', (_, state) => {
      if (state.status === VoiceConnectionStatus.Ready) {
        this.connected = true
      } else {
        this.reset()
        if (state.status === VoiceConnectionStatus.Disconnected && !this.closed) {
          this.fail()
        }
      }
    })
    connection.receiver.speaking.on('start', (id) => this.subscribe(id))
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000)
    if (!this.closed) {
      this.connected = true
    }
  }

  private subscribe(id: string) {
    if (!this.ready() || this.speakers.has(id) || id === this.client.user?.id) {
      return
    }
    const guildId = this.configuration.discordGuildId
    const voice = guildId
      ? this.client.guilds.cache.get(guildId)?.voiceStates.cache.get(id)
      : undefined
    if (
      voice?.channelId !== this.configuration.discordVoiceChannelId ||
      (this.configuration.captureMode === 'SELECTED_USERS' &&
        !this.configuration.commanderIds.includes(id))
    ) {
      return
    }
    const connection = this.connection
    if (!connection) {
      return
    }
    const stream = connection.receiver.subscribe(id, {
      end: { behavior: EndBehaviorType.Manual },
    })
    const decoder = new opus.OpusEncoder(48_000, 2)
    const speaker: Speaker = {
      id,
      displayName: voice.member?.displayName ?? id,
      receivedFrames: 0,
      stream,
    }
    this.speakers.set(id, speaker)
    stream.on('data', (packet: Buffer) => {
      if (!this.ready() || this.speakers.get(id) !== speaker) {
        return
      }
      try {
        const pcm = decoder.decode(packet)
        speaker.receivedFrames += 1
        this.frame(id, pcm, speaker.displayName)
      } catch {
        this.fail()
      }
    })
    stream.once('error', () => this.fail())
    stream.once('close', () => {
      if (this.speakers.get(id) === speaker) {
        this.remove(id)
      }
    })
  }

  private remove(id: string) {
    const speaker = this.speakers.get(id)
    this.speakers.delete(id)
    speaker?.stream.destroy()
    this.removed(id)
  }
  private reset() {
    this.connected = false
    for (const id of this.speakers.keys()) {
      this.remove(id)
    }
  }
  private fail() {
    this.reset()
    if (!this.closed) {
      this.failed()
    }
  }
  async close() {
    this.closed = true
    this.reset()
    if (this.connection?.state.status !== VoiceConnectionStatus.Destroyed) {
      this.connection?.destroy()
    }
    await this.client.destroy()
    await this.opening?.catch(() => {})
    if (this.connection?.state.status !== VoiceConnectionStatus.Destroyed) {
      this.connection?.destroy()
    }
    await this.client.destroy()
  }
}
