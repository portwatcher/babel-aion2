import {
  SUBTITLE_HISTORY_WINDOW_MS,
  type Subtitle,
  type SubtitleHistory,
  type SubtitleHistoryItem,
} from '@babel/contracts'

interface CachedEntry {
  order: number
  recordedAtMs: number
  updatedAtMs: number
  item: SubtitleHistoryItem
}

interface RoomHistory {
  lastUpdatedAt: number
  languages: Map<string, Map<string, CachedEntry>>
}

const MAX_ENTRIES_PER_LANGUAGE = 200
const MAX_LANGUAGES_PER_ROOM = 32
const MAX_ROOMS = 256

function compareRevisions(incoming: Subtitle, existing: SubtitleHistoryItem) {
  if (incoming.sourceGeneration !== existing.sourceGeneration) {
    return incoming.sourceGeneration - existing.sourceGeneration
  }
  if (incoming.streamGeneration !== existing.streamGeneration) {
    return incoming.streamGeneration - existing.streamGeneration
  }
  if (incoming.configurationVersion !== existing.configurationVersion) {
    return incoming.configurationVersion - existing.configurationVersion
  }
  if (incoming.sourceRevision !== existing.sourceRevision) {
    return incoming.sourceRevision - existing.sourceRevision
  }
  return incoming.translationRevision - existing.translationRevision
}

function toHistoryItem(
  subtitle: Subtitle,
  recordedAt: string,
  updatedAt: string,
): SubtitleHistoryItem {
  return {
    roomId: subtitle.roomId,
    sourceGeneration: subtitle.sourceGeneration,
    streamGeneration: subtitle.streamGeneration,
    speakerId: subtitle.speakerId,
    speakerDisplayName: subtitle.speakerDisplayName,
    utteranceId: subtitle.utteranceId,
    sourceRevision: subtitle.sourceRevision,
    translationRevision: subtitle.translationRevision,
    sequence: subtitle.sequence,
    sourceLanguage: subtitle.sourceLanguage,
    originalText: subtitle.originalText,
    outputLanguage: subtitle.outputLanguage,
    translatedText: subtitle.translatedText,
    sourceIsFinal: subtitle.sourceIsFinal,
    translationIsFinal: subtitle.translationIsFinal,
    configurationVersion: subtitle.configurationVersion,
    recordedAt,
    updatedAt,
  }
}

/**
 * Ephemeral in-memory cache of translated utterances delivered per room and
 * output language over a rolling five-minute window. Languages are created
 * strictly on demand when translated records are produced for active listeners.
 */
export class SubtitleHistoryCache {
  private readonly rooms = new Map<string, RoomHistory>()
  private order = 0

  constructor(private readonly windowMs = SUBTITLE_HISTORY_WINDOW_MS) {}

  record(subtitle: Subtitle, now = Date.now()) {
    if (subtitle.failure !== null) {
      return
    }
    const hasTranslation = subtitle.translatedText.trim().length > 0
    const hasOriginal = subtitle.originalText.trim().length > 0
    if (!hasTranslation) {
      if (!hasOriginal) {
        this.deleteUtterance(
          subtitle.roomId,
          subtitle.outputLanguage,
          subtitle.utteranceId,
        )
      }
      return
    }
    this.pruneRoom(subtitle.roomId, now)
    let room = this.rooms.get(subtitle.roomId)
    if (!room) {
      if (this.rooms.size >= MAX_ROOMS) {
        this.prune(now)
        if (this.rooms.size >= MAX_ROOMS) {
          this.evictOldestRoom()
        }
      }
      room = { lastUpdatedAt: now, languages: new Map() }
      this.rooms.set(subtitle.roomId, room)
    }
    room.lastUpdatedAt = now
    let entries = room.languages.get(subtitle.outputLanguage)
    if (!entries) {
      if (room.languages.size >= MAX_LANGUAGES_PER_ROOM) {
        this.evictOldestLanguage(room)
      }
      entries = new Map()
      room.languages.set(subtitle.outputLanguage, entries)
    }
    const existing = entries.get(subtitle.utteranceId)
    const timestamp = new Date(now).toISOString()
    if (existing) {
      const comparison = compareRevisions(subtitle, existing.item)
      if (comparison < 0) {
        return
      }
      if (
        comparison === 0 &&
        subtitle.translatedText.length <= existing.item.translatedText.length &&
        subtitle.originalText.length <= existing.item.originalText.length
      ) {
        return
      }
      existing.updatedAtMs = now
      existing.item = toHistoryItem(subtitle, existing.item.recordedAt, timestamp)
      return
    }
    if (entries.size >= MAX_ENTRIES_PER_LANGUAGE) {
      let oldestId: string | null = null
      let oldestOrder = Number.POSITIVE_INFINITY
      for (const [id, candidate] of entries) {
        if (candidate.order < oldestOrder) {
          oldestOrder = candidate.order
          oldestId = id
        }
      }
      if (oldestId) {
        entries.delete(oldestId)
      }
    }
    entries.set(subtitle.utteranceId, {
      order: ++this.order,
      recordedAtMs: now,
      updatedAtMs: now,
      item: toHistoryItem(subtitle, timestamp, timestamp),
    })
  }

  read(
    roomId: string,
    outputLanguage: string | null,
    enabledLanguages: readonly string[],
    now = Date.now(),
  ): SubtitleHistory {
    this.pruneRoom(roomId, now)
    const room = this.rooms.get(roomId)
    const enabled = new Set(enabledLanguages)
    const availableLanguages = enabledLanguages.filter((code) => {
      const entries = room?.languages.get(code)
      return Boolean(entries && entries.size > 0)
    })
    const activeLanguage =
      outputLanguage && enabled.has(outputLanguage) ? outputLanguage : null
    const entries = activeLanguage ? room?.languages.get(activeLanguage) : undefined
    const items = entries
      ? [...entries.values()]
          .sort((a, b) => a.order - b.order)
          .map((entry) => entry.item)
      : []
    return {
      roomId,
      outputLanguage: activeLanguage,
      windowMs: this.windowMs,
      availableLanguages,
      items,
      serverNow: new Date(now).toISOString(),
    }
  }

  prune(now = Date.now()) {
    for (const roomId of [...this.rooms.keys()]) {
      this.pruneRoom(roomId, now)
    }
  }

  clear() {
    this.rooms.clear()
  }

  private pruneRoom(roomId: string, now: number) {
    const room = this.rooms.get(roomId)
    if (!room) {
      return
    }
    const cutoff = now - this.windowMs
    for (const [language, entries] of room.languages) {
      for (const [utteranceId, entry] of entries) {
        if (entry.updatedAtMs < cutoff) {
          entries.delete(utteranceId)
        }
      }
      if (entries.size === 0) {
        room.languages.delete(language)
      }
    }
    if (room.languages.size === 0) {
      this.rooms.delete(roomId)
    }
  }

  private deleteUtterance(roomId: string, outputLanguage: string, utteranceId: string) {
    const room = this.rooms.get(roomId)
    const entries = room?.languages.get(outputLanguage)
    if (!room || !entries) {
      return
    }
    entries.delete(utteranceId)
    if (entries.size === 0) {
      room.languages.delete(outputLanguage)
    }
    if (room.languages.size === 0) {
      this.rooms.delete(roomId)
    }
  }

  private evictOldestLanguage(room: RoomHistory) {
    let oldestCode: string | null = null
    let oldestTimestamp = Number.POSITIVE_INFINITY
    for (const [code, entries] of room.languages) {
      let newestInLanguage = 0
      for (const entry of entries.values()) {
        if (entry.updatedAtMs > newestInLanguage) {
          newestInLanguage = entry.updatedAtMs
        }
      }
      if (newestInLanguage < oldestTimestamp) {
        oldestTimestamp = newestInLanguage
        oldestCode = code
      }
    }
    if (oldestCode) {
      room.languages.delete(oldestCode)
    }
  }

  private evictOldestRoom() {
    let oldestId: string | null = null
    let oldestTimestamp = Number.POSITIVE_INFINITY
    for (const [id, room] of this.rooms) {
      if (room.lastUpdatedAt < oldestTimestamp) {
        oldestTimestamp = room.lastUpdatedAt
        oldestId = id
      }
    }
    if (oldestId) {
      this.rooms.delete(oldestId)
    }
  }
}
