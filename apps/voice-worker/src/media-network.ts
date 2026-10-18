import { createHmac, randomBytes } from 'node:crypto'
import { isIPv4 } from 'node:net'
import { networkInterfaces } from 'node:os'
import { iceUrlSchema, type MediaIceConfiguration } from '@babel/contracts'
import type { PeerConfig } from 'werift'

export interface MediaNetwork {
  create(): {
    worker: Partial<PeerConfig>
    browser: MediaIceConfiguration
    expiresAt: number
  }
}

export class MediaNetworkConfigurationError extends Error {
  constructor() {
    super('Invalid media network configuration')
  }
}

function url(value: string, protocols: string[]) {
  if (
    !iceUrlSchema.safeParse(value).success ||
    !protocols.includes(value.split(':')[0] ?? '')
  ) {
    throw new MediaNetworkConfigurationError()
  }
  return value
}

/** Private runtime configuration; only temporary relay credentials reach players. */
export function createMediaNetwork(
  environment: Record<string, string | undefined>,
): MediaNetwork {
  const stun = environment.MEDIA_STUN_URL
    ? url(environment.MEDIA_STUN_URL, ['stun'])
    : undefined
  let turnUrls: string[] = []
  try {
    const input: unknown = JSON.parse(environment.MEDIA_TURN_URLS || '[]')
    if (
      !Array.isArray(input) ||
      input.length > 4 ||
      input.some((value) => typeof value !== 'string')
    ) {
      throw new MediaNetworkConfigurationError()
    }
    turnUrls = input.map((value: string) => url(value, ['turn', 'turns']))
  } catch {
    throw new MediaNetworkConfigurationError()
  }
  const sharedSecret = environment.MEDIA_TURN_SHARED_SECRET ?? ''
  if (
    Boolean(turnUrls.length) !== Boolean(sharedSecret) ||
    (sharedSecret && !/^[\x21-\x7e]{32,4096}$/.test(sharedSecret))
  ) {
    throw new MediaNetworkConfigurationError()
  }
  const workerTurn = environment.MEDIA_WORKER_TURN_URL
    ? url(environment.MEDIA_WORKER_TURN_URL, ['turn', 'turns'])
    : turnUrls[0]
  if (workerTurn && !turnUrls.length) {
    throw new MediaNetworkConfigurationError()
  }
  const policy = environment.MEDIA_ICE_POLICY || 'all'
  const browserPolicy = environment.MEDIA_BROWSER_ICE_POLICY || 'all'
  if (
    ![policy, browserPolicy].every((value) => value === 'all' || value === 'relay') ||
    ([policy, browserPolicy].includes('relay') && !turnUrls.length) ||
    (turnUrls.length && policy === 'all' && !stun)
  ) {
    throw new MediaNetworkConfigurationError()
  }
  const ttl = Number(environment.MEDIA_TURN_TTL_SECONDS || '3600')
  if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > 86400) {
    throw new MediaNetworkConfigurationError()
  }
  let portRange: [number, number] | undefined
  if (environment.MEDIA_ICE_PORT_RANGE) {
    const values = environment.MEDIA_ICE_PORT_RANGE.split('-').map(Number)
    if (
      values.length !== 2 ||
      !values.every(
        (value) => Number.isInteger(value) && value >= 1024 && value <= 65535,
      ) ||
      values[0]! >= values[1]!
    ) {
      throw new MediaNetworkConfigurationError()
    }
    portRange = [values[0]!, values[1]!]
  }
  const bindAddress = environment.MEDIA_ICE_BIND_ADDRESS || undefined
  if (
    bindAddress &&
    (!isIPv4(bindAddress) ||
      bindAddress.startsWith('127.') ||
      !Object.values(networkInterfaces())
        .flat()
        .some((value) => value?.address === bindAddress))
  ) {
    throw new MediaNetworkConfigurationError()
  }
  if (portRange && !bindAddress) {
    throw new MediaNetworkConfigurationError()
  }

  return {
    create() {
      const expiresAt = turnUrls.length
        ? (Math.floor(Date.now() / 1000) + ttl) * 1000
        : Infinity
      const credentials = () => {
        const username = `${Math.floor(expiresAt / 1000)}:${randomBytes(16).toString('hex')}`
        return {
          username,
          credential: createHmac('sha1', sharedSecret)
            .update(username)
            .digest('base64'),
        }
      }
      const browser: MediaIceConfiguration = {
        servers: [
          ...(stun ? [{ urls: [stun] }] : []),
          ...(turnUrls.length ? [{ urls: turnUrls, ...credentials() }] : []),
        ],
        policy: browserPolicy === 'relay' ? 'relay' : 'all',
        renewAfterMs: turnUrls.length ? (ttl - 30) * 1000 : null,
      }
      const worker: Partial<PeerConfig> = {
        iceServers: [
          ...(stun ? [{ urls: stun }] : []),
          ...(workerTurn ? [{ urls: workerTurn, ...credentials() }] : []),
        ],
        iceTransportPolicy: policy === 'relay' ? 'relay' : 'all',
        // Werift otherwise supplies its own Google STUN fallback for an empty list.
        // ICE-lite gathers only host candidates and contacts no discovery service.
        iceLite: !stun && !workerTurn,
        iceUseIpv6: false,
        iceUseTcp: false,
        icePortRange: portRange,
        iceInterfaceAddresses: bindAddress ? { udp4: bindAddress } : undefined,
        iceStunGatherTimeout: 2,
        iceTurnConnectTimeout: 5,
      }
      return { worker, browser, expiresAt }
    },
  }
}
