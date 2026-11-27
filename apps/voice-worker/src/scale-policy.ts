import type { VoiceScaleMetrics } from '@babel/contracts'
import type { VoiceScaleLoad } from '@babel/database/runtime-owners'

export interface BurstScalePolicy {
  /** Minimum active listeners before requesting the first burst fan-out replica. */
  activationListeners: number
  /** Target listeners per burst fan-out replica once activated. */
  listenersPerReplica: number
}

const DEFAULT_ACTIVATION_LISTENERS = 15
const DEFAULT_LISTENERS_PER_REPLICA = 250

export function parseFanoutOnly(value: string | undefined) {
  const normalized = value?.trim().toLowerCase() ?? ''
  if (!normalized || normalized === '0' || normalized === 'false') {
    return false
  }
  if (normalized === '1' || normalized === 'true') {
    return true
  }
  throw new Error('Invalid MEDIA_FANOUT_ONLY value')
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
) {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) {
    return fallback
  }
  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100_000) {
    throw new Error(`Invalid ${name} value`)
  }
  return parsed
}

export function parseBurstScalePolicy(env: NodeJS.ProcessEnv): BurstScalePolicy {
  return {
    activationListeners: parsePositiveInteger(
      env.SCALE_BURST_ACTIVATION_LISTENERS,
      DEFAULT_ACTIVATION_LISTENERS,
      'SCALE_BURST_ACTIVATION_LISTENERS',
    ),
    listenersPerReplica: parsePositiveInteger(
      env.SCALE_BURST_LISTENERS_PER_REPLICA,
      DEFAULT_LISTENERS_PER_REPLICA,
      'SCALE_BURST_LISTENERS_PER_REPLICA',
    ),
  }
}

export function computeVoiceScaleMetrics(
  load: VoiceScaleLoad,
  policy: BurstScalePolicy,
): VoiceScaleMetrics {
  const activeListeners = Math.max(load.activeSessions, load.openMediaConnections)
  const desiredBurstReplicas =
    activeListeners < policy.activationListeners
      ? 0
      : Math.max(1, Math.ceil(activeListeners / policy.listenersPerReplica))
  return {
    activeSessions: load.activeSessions,
    openMediaConnections: load.openMediaConnections,
    activeListeners,
    activeVoiceSources: load.activeVoiceSources,
    activeFanoutWorkers: load.activeFanoutWorkers,
    desiredBurstReplicas,
  }
}
