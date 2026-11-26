import {
  SUBTITLE_HISTORY_WINDOW_MS,
  type Subtitle,
  type SubtitleHistory,
  type SubtitleHistoryItem,
} from '@babel/contracts'

interface LocalHistoryEntry {
  order: number
  recordedAtMs: number
  expiresAtMs: number
  item: SubtitleHistoryItem
}

const MAX_HISTORY_ITEMS = 200

function compareRevisions(
  incoming: Pick<
    SubtitleHistoryItem,
    | 'sourceGeneration'
    | 'streamGeneration'
    | 'configurationVersion'
    | 'sourceRevision'
    | 'translationRevision'
  >,
  existing: Pick<
    SubtitleHistoryItem,
    | 'sourceGeneration'
    | 'streamGeneration'
    | 'configurationVersion'
    | 'sourceRevision'
    | 'translationRevision'
  >,
) {
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

function compareChronology(a: LocalHistoryEntry, b: LocalHistoryEntry) {
  if (a.recordedAtMs !== b.recordedAtMs) {
    return a.recordedAtMs - b.recordedAtMs
  }
  if (a.item.sourceGeneration !== b.item.sourceGeneration) {
    return a.item.sourceGeneration - b.item.sourceGeneration
  }
  if (a.item.streamGeneration !== b.item.streamGeneration) {
    return a.item.streamGeneration - b.item.streamGeneration
  }
  if (a.item.sequence !== b.item.sequence) {
    return a.item.sequence - b.item.sequence
  }
  return a.order - b.order
}

function fromLiveSubtitle(subtitle: Subtitle, recordedAt: string): SubtitleHistoryItem {
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
    updatedAt: subtitle.serverSentAt,
  }
}

/**
 * Maintains the room's rolling five-minute translation history for the listener's
 * selected output language, merging server-cached snapshots with live updates
 * without clock-skew drift.
 */
export class SubtitleHistoryView {
  private roomId: string | null = null
  private outputLanguage: string | null = null
  private windowMs = SUBTITLE_HISTORY_WINDOW_MS
  private order = 0
  private readonly entries = new Map<string, LocalHistoryEntry>()

  reset(): SubtitleHistoryItem[] {
    this.roomId = null
    this.outputLanguage = null
    this.windowMs = SUBTITLE_HISTORY_WINDOW_MS
    this.order = 0
    this.entries.clear()
    return []
  }

  hydrate(snapshot: SubtitleHistory, localNow = Date.now()): SubtitleHistoryItem[] {
    if (
      this.roomId !== snapshot.roomId ||
      this.outputLanguage !== snapshot.outputLanguage
    ) {
      this.entries.clear()
      this.order = 0
      this.roomId = snapshot.roomId
      this.outputLanguage = snapshot.outputLanguage
    }
    this.windowMs = snapshot.windowMs
    const serverNowMs = Date.parse(snapshot.serverNow)
    for (const item of snapshot.items) {
      if (
        item.roomId !== snapshot.roomId ||
        item.outputLanguage !== snapshot.outputLanguage ||
        !item.translatedText.trim()
      ) {
        continue
      }
      const updatedAtMs = Date.parse(item.updatedAt)
      const ageMs =
        Number.isFinite(serverNowMs) && Number.isFinite(updatedAtMs)
          ? Math.max(0, serverNowMs - updatedAtMs)
          : 0
      const expiresAtMs = localNow + Math.max(0, this.windowMs - ageMs)
      if (expiresAtMs <= localNow) {
        continue
      }
      this.upsert(item, expiresAtMs, localNow)
    }
    this.pruneInternal(localNow)
    this.enforceLimit()
    return this.current()
  }

  accept(subtitle: Subtitle, localNow = Date.now()): SubtitleHistoryItem[] {
    if (subtitle.failure !== null) {
      return this.current()
    }
    if (
      this.roomId !== null &&
      (this.roomId !== subtitle.roomId ||
        this.outputLanguage !== subtitle.outputLanguage)
    ) {
      return this.current()
    }
    const hasTranslation = subtitle.translatedText.trim().length > 0
    const hasOriginal = subtitle.originalText.trim().length > 0
    if (!hasTranslation) {
      if (!hasOriginal && this.entries.delete(subtitle.utteranceId)) {
        return this.current()
      }
      return this.current()
    }
    this.roomId = subtitle.roomId
    this.outputLanguage = subtitle.outputLanguage
    const existing = this.entries.get(subtitle.utteranceId)
    const item = fromLiveSubtitle(
      subtitle,
      existing?.item.recordedAt ?? subtitle.serverSentAt,
    )
    this.upsert(item, localNow + this.windowMs, localNow)
    this.pruneInternal(localNow)
    this.enforceLimit()
    return this.current()
  }

  prune(localNow = Date.now()): { changed: boolean; items: SubtitleHistoryItem[] } {
    const changed = this.pruneInternal(localNow)
    return { changed, items: this.current() }
  }

  private upsert(item: SubtitleHistoryItem, expiresAtMs: number, localNow: number) {
    const parsedRecordedAt = Date.parse(item.recordedAt)
    const recordedAtMs = Number.isFinite(parsedRecordedAt) ? parsedRecordedAt : localNow
    const existing = this.entries.get(item.utteranceId)
    if (!existing) {
      this.entries.set(item.utteranceId, {
        order: ++this.order,
        recordedAtMs,
        expiresAtMs,
        item,
      })
      return
    }
    const earliestRecordedAtMs = Math.min(existing.recordedAtMs, recordedAtMs)
    const earliestRecordedAt =
      recordedAtMs < existing.recordedAtMs ? item.recordedAt : existing.item.recordedAt
    const comparison = compareRevisions(item, existing.item)
    existing.expiresAtMs = Math.max(existing.expiresAtMs, expiresAtMs)
    existing.recordedAtMs = earliestRecordedAtMs
    if (comparison < 0) {
      existing.item = { ...existing.item, recordedAt: earliestRecordedAt }
      return
    }
    if (
      comparison === 0 &&
      item.translatedText.length <= existing.item.translatedText.length &&
      item.originalText.length <= existing.item.originalText.length
    ) {
      existing.item = { ...existing.item, recordedAt: earliestRecordedAt }
      return
    }
    existing.item = { ...item, recordedAt: earliestRecordedAt }
  }

  private pruneInternal(localNow: number) {
    let changed = false
    for (const [id, entry] of this.entries) {
      if (entry.expiresAtMs <= localNow) {
        this.entries.delete(id)
        changed = true
      }
    }
    return changed
  }

  private enforceLimit() {
    if (this.entries.size <= MAX_HISTORY_ITEMS) {
      return
    }
    const sorted = [...this.entries.entries()].sort((a, b) =>
      compareChronology(a[1], b[1]),
    )
    const excess = this.entries.size - MAX_HISTORY_ITEMS
    for (let index = 0; index < excess; index += 1) {
      const oldest = sorted[index]
      if (oldest) {
        this.entries.delete(oldest[0])
      }
    }
  }

  private current(): SubtitleHistoryItem[] {
    return [...this.entries.values()].sort(compareChronology).map((entry) => entry.item)
  }
}
