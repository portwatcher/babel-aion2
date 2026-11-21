import type { ProviderTestCode } from '@babel/contracts'
import { ProviderFailure } from './errors.ts'
import { streamTextTranslation } from './openai-translation.ts'
import type { TranslationTerminology } from './terminology.ts'
import type { TranslationPath } from './subtitle-work.ts'

export interface TranslationJob {
  utteranceId: string
  text: string
  isFinal: boolean
}

interface InFlightTranslation {
  utteranceId: string
  sourceText: string
  becomesFinal: boolean
  controller: AbortController
  refreshTimeout?: () => void
}

/** Batch rapid 20 ms recognition deltas without delaying incremental captions. */
const COALESCE_MS = 80

/** Single-flight streaming text translation coordinator for one target language. */
export function createTranslationLane(input: {
  path: TranslationPath
  glossary: TranslationTerminology
  signal?: AbortSignal
  isActive: () => boolean
  isDirect: () => boolean
  isEnding: () => boolean
  currentUtteranceId: () => string
  onProgress: (value: {
    text: string
    isFinal: boolean
    termCount: number
    discontinuity: boolean
  }) => void
  onFailure: (code: Exclude<ProviderTestCode, 'PASS'>) => void
  onReset: () => void
}) {
  let failed = false
  let attempt = 0
  let retryAt: number | null = null
  let translatedSource: string | null = null
  let inFlight: InFlightTranslation | null = null
  let queued: TranslationJob | null = null
  let coalesceTimer: ReturnType<typeof setTimeout> | null = null
  const idleResolvers: Array<() => void> = []

  function notifyIdle() {
    if (inFlight || queued || coalesceTimer) {
      return
    }
    const resolvers = idleResolvers.splice(0)
    for (const resolve of resolvers) {
      resolve()
    }
  }

  function cancelPending() {
    if (coalesceTimer) {
      clearTimeout(coalesceTimer)
      coalesceTimer = null
    }
    queued = null
    if (inFlight) {
      const current = inFlight
      inFlight = null
      current.controller.abort()
    }
  }

  function recordFailure(error: unknown, failedJob: TranslationJob) {
    if (!input.isActive()) {
      return
    }
    const code = error instanceof ProviderFailure ? error.code : 'UNAVAILABLE'
    failed = true
    attempt += 1
    translatedSource = null
    if (
      !input.isEnding() &&
      ['TIMEOUT', 'UNAVAILABLE', 'RATE_LIMITED'].includes(code)
    ) {
      retryAt = Date.now() + Math.min(5000, 250 * 2 ** (attempt - 1))
      queued ??= failedJob
    } else {
      retryAt = null
      queued = null
      notifyIdle()
    }
    if (!input.isDirect()) {
      input.onFailure(code)
    }
  }

  async function run() {
    if (coalesceTimer) {
      clearTimeout(coalesceTimer)
      coalesceTimer = null
    }
    if (inFlight || failed || !input.isActive() || input.isDirect()) {
      if (input.isDirect()) {
        queued = null
      }
      notifyIdle()
      return
    }
    const job = queued
    queued = null
    if (!job || !job.text.trim()) {
      notifyIdle()
      return
    }
    if (translatedSource === job.text) {
      if (job.isFinal) {
        input.onProgress({
          text: '',
          isFinal: true,
          termCount: input.glossary.termCount,
          discontinuity: false,
        })
      }
      notifyIdle()
      return
    }
    const controller = new AbortController()
    const signal = input.signal
      ? AbortSignal.any([input.signal, controller.signal])
      : controller.signal
    const current: InFlightTranslation = {
      utteranceId: job.utteranceId,
      sourceText: job.text,
      becomesFinal: job.isFinal,
      controller,
    }
    inFlight = current
    let accumulated = ''
    let streamedDelta = false
    let truncated = false
    try {
      const full = await streamTextTranslation({
        settings: input.path.settings,
        credential: input.path.credential,
        outputLanguage: input.path.outputLanguage,
        text: job.text,
        glossary: input.glossary.glossary || undefined,
        signal,
        onReady(refreshTimeout) {
          current.refreshTimeout = refreshTimeout
        },
        onDelta(delta) {
          if (
            inFlight !== current ||
            !input.isActive() ||
            input.isDirect() ||
            input.currentUtteranceId() !== current.utteranceId
          ) {
            return
          }
          accumulated += delta
          if (accumulated.length > 4096) {
            accumulated = accumulated.slice(-4096).replace(/^[\uDC00-\uDFFF]/u, '')
            truncated = true
          }
          streamedDelta = true
          input.onProgress({
            text: accumulated,
            isFinal: false,
            termCount: input.glossary.termCount,
            discontinuity: truncated,
          })
        },
      })
      if (inFlight !== current || !input.isActive()) {
        notifyIdle()
        return
      }
      inFlight = null
      attempt = 0
      retryAt = null
      if (!input.isDirect() && input.currentUtteranceId() === current.utteranceId) {
        const trimmed =
          full.length > 4096 ? full.slice(-4096).replace(/^[\uDC00-\uDFFF]/u, '') : full
        if (trimmed.length !== full.length) {
          truncated = true
        }
        translatedSource = current.sourceText
        if (current.becomesFinal && !queued) {
          input.onProgress({
            text: trimmed,
            isFinal: true,
            termCount: input.glossary.termCount,
            discontinuity: truncated,
          })
        } else if (!streamedDelta && trimmed) {
          input.onProgress({
            text: trimmed,
            isFinal: false,
            termCount: input.glossary.termCount,
            discontinuity: truncated,
          })
        }
      }
      if (queued) {
        void run()
      } else {
        notifyIdle()
      }
    } catch (error) {
      if (inFlight === current) {
        inFlight = null
      }
      if (controller.signal.aborted && !input.signal?.aborted) {
        if (queued) {
          void run()
        } else {
          notifyIdle()
        }
        return
      }
      recordFailure(error, {
        utteranceId: current.utteranceId,
        text: current.sourceText,
        isFinal: current.becomesFinal,
      })
    }
  }

  return {
    schedule(job: TranslationJob, alreadyFinal: boolean) {
      if (failed) {
        if (retryAt !== null && Date.now() >= retryAt) {
          failed = false
          retryAt = null
        } else {
          if (retryAt !== null) {
            queued = job
          } else {
            notifyIdle()
          }
          return false
        }
      }
      if (!inFlight && translatedSource === job.text) {
        if (job.isFinal && !alreadyFinal) {
          notifyIdle()
          return true
        }
        notifyIdle()
        return false
      }
      if (
        inFlight &&
        inFlight.utteranceId === job.utteranceId &&
        inFlight.sourceText === job.text
      ) {
        if (job.isFinal) {
          inFlight.becomesFinal = true
          inFlight.refreshTimeout?.()
        }
        queued = null
        return false
      }
      queued = job
      if (inFlight) {
        return false
      }
      if (job.isFinal || input.isEnding()) {
        void run()
        return false
      }
      if (!coalesceTimer) {
        coalesceTimer = setTimeout(() => {
          coalesceTimer = null
          void run()
        }, COALESCE_MS)
        coalesceTimer.unref()
      }
      return false
    },
    resetUtterance(emptySource = false) {
      cancelPending()
      translatedSource = emptySource ? '' : null
      notifyIdle()
    },
    pollRetry(now: number) {
      if (failed && retryAt !== null && retryAt <= now) {
        failed = false
        retryAt = null
        if (!input.isDirect()) {
          input.onReset()
          if (queued) {
            void run()
          }
        }
      }
    },
    flushForEnd() {
      inFlight?.refreshTimeout?.()
      if (coalesceTimer) {
        clearTimeout(coalesceTimer)
        coalesceTimer = null
        void run()
      }
    },
    waitIdle() {
      if (!inFlight && !queued && !coalesceTimer) {
        return Promise.resolve()
      }
      return new Promise<void>((resolve) => {
        idleResolvers.push(resolve)
      })
    },
    close() {
      retryAt = null
      cancelPending()
      notifyIdle()
    },
  }
}
