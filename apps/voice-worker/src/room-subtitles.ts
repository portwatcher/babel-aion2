import type { ProviderTestCode } from '@babel/contracts'
import {
  SpeakerSubtitles,
  type RunningSubtitlePath,
  type SubtitleConsumer,
} from './speaker-subtitles.ts'

interface Speaker {
  name: string
  streams: Map<string, SpeakerSubtitles>
  retries: Map<string, number>
}

export class RoomSubtitles {
  private readonly speakers = new Map<string, Speaker>()
  private readonly consumers = new Map<string, SubtitleConsumer>()
  private paths = new Map<string, RunningSubtitlePath>()
  private generation = 0
  private closed = false

  constructor(
    readonly roomId: string,
    readonly sourceGeneration: number,
    private readonly allowed: () => boolean,
  ) {}

  reconcile(consumers: SubtitleConsumer[], paths: Map<string, RunningSubtitlePath>) {
    this.paths = paths
    this.consumers.clear()
    for (const consumer of consumers) {
      this.consumers.set(consumer.id, consumer)
    }
    for (const [id, speaker] of this.speakers) {
      this.reconcileSpeaker(id, speaker)
    }
  }

  private reconcileSpeaker(id: string, speaker: Speaker) {
    if (this.closed) {
      return
    }
    const groups = new Map<string, RunningSubtitlePath>()
    for (const consumer of this.consumers.values()) {
      const path = this.paths.get(consumer.outputLanguage)
      if (path) {
        groups.set(path.group, path)
      }
    }
    for (const [group, stream] of speaker.streams) {
      // The shared engine supplies the short unused-language release grace.
      stream.reconcile(this.consumers.values(), this.paths)
      if (![...this.paths.values()].some((path) => path.group === group)) {
        stream.close()
        speaker.streams.delete(group)
      }
    }
    for (const [group, path] of groups) {
      if (
        speaker.streams.has(group) ||
        (speaker.retries.get(group) ?? 0) > Date.now() ||
        !this.allowed()
      ) {
        continue
      }
      const generation = ++this.generation
      try {
        const stream = new SpeakerSubtitles(
          this.roomId,
          this.sourceGeneration,
          generation,
          id,
          () => speaker.name,
          group,
          path,
          () => !this.closed && this.allowed(),
          (code) => {
            if (speaker.streams.get(group)?.streamGeneration !== generation) {
              return
            }
            speaker.streams.delete(group)
            speaker.retries.set(group, Date.now() + (code ? 5_000 : 0))
            this.failure(id, generation, group, code)
          },
        )
        speaker.streams.set(group, stream)
        stream.reconcile(this.consumers.values(), this.paths)
      } catch {
        speaker.retries.set(group, Date.now() + 5_000)
        this.failure(id, generation, group, 'INVALID_CONFIGURATION')
      }
    }
  }

  private failure(
    id: string,
    generation: number,
    group: string,
    code: Exclude<ProviderTestCode, 'PASS'> | null,
  ) {
    for (const consumer of this.consumers.values()) {
      if (this.paths.get(consumer.outputLanguage)?.group !== group) {
        continue
      }
      consumer.deliver({
        type: 'subtitle-state',
        roomId: this.roomId,
        sourceGeneration: this.sourceGeneration,
        speakerId: id,
        streamGeneration: generation,
        outputLanguage: consumer.outputLanguage,
        state: code ? 'UNAVAILABLE' : 'CONNECTING',
        failure: code,
      })
    }
  }

  receive(id: string, name: string, pcm: Buffer) {
    if (this.closed || !this.allowed()) {
      return
    }
    let speaker = this.speakers.get(id)
    if (!speaker) {
      speaker = { name, streams: new Map(), retries: new Map() }
      this.speakers.set(id, speaker)
      this.reconcileSpeaker(id, speaker)
    }
    speaker.name = name
    for (const stream of speaker.streams.values()) {
      stream.receive(pcm)
    }
  }

  remove(id: string) {
    const speaker = this.speakers.get(id)
    if (!speaker) {
      return
    }
    for (const stream of speaker.streams.values()) {
      stream.close()
    }
    this.speakers.delete(id)
    for (const consumer of this.consumers.values()) {
      consumer.deliver({
        type: 'subtitle-state',
        roomId: this.roomId,
        sourceGeneration: this.sourceGeneration,
        speakerId: id,
        streamGeneration: ++this.generation,
        outputLanguage: consumer.outputLanguage,
        state: 'WAITING',
        failure: null,
      })
    }
  }

  close() {
    this.closed = true
    for (const speaker of this.speakers.values()) {
      for (const stream of speaker.streams.values()) {
        stream.close()
      }
    }
    this.speakers.clear()
    this.consumers.clear()
  }
}
