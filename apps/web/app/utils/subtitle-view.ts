import type { Subtitle, SubtitleMessage } from '@babel/contracts'

export interface SubtitlePresentation {
  items: Subtitle[]
  state: 'WAITING' | 'CONNECTING' | 'UNAVAILABLE' | 'STOPPED'
  failure: string | null
}

/** Ordering is source/stream/utterance order, never translation completion order. */
export class SubtitleView {
  private generation = 0
  private retiredGeneration = -1
  private order = 0
  private readonly speakers = new Map<
    string,
    { stream: number; value: Subtitle | null; order: number }
  >()
  private state: SubtitlePresentation['state'] = 'WAITING'
  private failure: string | null = null

  reset() {
    this.generation = 0
    this.retiredGeneration = -1
    this.order = 0
    this.speakers.clear()
    this.state = 'WAITING'
    this.failure = null
    return this.current()
  }

  accept(message: SubtitleMessage) {
    const incoming = message.type === 'subtitle' ? message.value : message
    if (
      incoming.sourceGeneration < this.generation ||
      incoming.sourceGeneration <= this.retiredGeneration
    ) {
      return this.current()
    }
    if (incoming.sourceGeneration > this.generation) {
      this.speakers.clear()
      this.generation = incoming.sourceGeneration
    }
    if (message.type === 'subtitle-state') {
      const known =
        message.speakerId === null ? null : this.speakers.get(message.speakerId)
      if (known && message.streamGeneration < known.stream) {
        return this.current()
      }
      this.state = message.state
      this.failure = message.failure
      if (message.speakerId === null) {
        if (message.state === 'STOPPED') {
          this.retiredGeneration = message.sourceGeneration
        }
        for (const speaker of this.speakers.values()) {
          speaker.value = null
        }
      } else {
        const prior = this.speakers.get(message.speakerId)
        if (!prior || message.streamGeneration >= prior.stream) {
          this.speakers.set(message.speakerId, {
            stream: message.streamGeneration,
            value: null,
            order: ++this.order,
          })
        }
      }
      return this.current()
    }
    const value = message.value
    const prior = this.speakers.get(value.speakerId)
    const previous = prior?.value
    if (prior && value.streamGeneration < prior.stream) {
      return this.current()
    }
    if (previous && value.streamGeneration === prior.stream) {
      if (
        value.configurationVersion < previous.configurationVersion ||
        (value.configurationVersion === previous.configurationVersion &&
          (value.sequence < previous.sequence ||
            (value.sequence === previous.sequence &&
              (value.sourceRevision < previous.sourceRevision ||
                (value.sourceRevision === previous.sourceRevision &&
                  value.translationRevision < previous.translationRevision)))))
      ) {
        return this.current()
      }
    }
    const changedSpeech =
      !previous ||
      value.streamGeneration !== previous.streamGeneration ||
      value.sequence !== previous.sequence ||
      value.sourceRevision !== previous.sourceRevision
    this.speakers.set(value.speakerId, {
      stream: value.streamGeneration,
      value,
      order: changedSpeech ? ++this.order : (prior?.order ?? ++this.order),
    })
    this.state = value.failure ? 'UNAVAILABLE' : 'WAITING'
    this.failure = value.failure
    // A bounded display does not retain an entire battle or revive old speakers.
    if (this.speakers.size > 100) {
      const oldest = [...this.speakers].sort((a, b) => a[1].order - b[1].order)[0]
      if (oldest) {
        this.speakers.delete(oldest[0])
      }
    }
    return this.current()
  }

  private current(): SubtitlePresentation {
    return {
      state: this.state,
      failure: this.failure,
      items: [...this.speakers.values()]
        .sort((a, b) => b.order - a.order)
        .flatMap((speaker) =>
          speaker.value &&
          (speaker.value.originalText.trim() || speaker.value.translatedText.trim())
            ? [speaker.value]
            : [],
        )
        .slice(0, 2),
    }
  }
}
