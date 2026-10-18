import {
  providerSettingsSchema,
  providerTestResultSchema,
  type ProviderSettings,
  type ProviderSummary,
  type ProviderTestResult,
} from '@babel/contracts'
import type { providerConfiguration } from '../schema/rooms.ts'

export class ProviderConfigurationError extends Error {
  constructor(
    readonly code:
      | 'NOT_FOUND'
      | 'VERSION_CONFLICT'
      | 'INVALID_CONFIGURATION'
      | 'INVALID_AUDIO'
      | 'REQUEST_TOO_LARGE'
      | 'TYPE_IMMUTABLE'
      | 'TEST_IN_PROGRESS'
      | 'TEST_COOLDOWN'
      | 'PROVIDER_IN_USE'
      | 'CONNECTION_TEST_FAILED',
    readonly testCode?: ProviderTestResult['code'],
  ) {
    super(code)
  }
}

export type StoredProvider = typeof providerConfiguration.$inferSelect
export type ConnectionProbe = (
  settings: ProviderSettings,
  credential: string,
) => Promise<Omit<ProviderTestResult, 'configurationVersion'>>

export interface ProtectedProvider {
  id: string
  version: number
  settings: ProviderSettings
  credential: string
}

export function settingsOf(stored: StoredProvider) {
  const result = providerSettingsSchema.safeParse(stored.publicSettings)
  if (!result.success || result.data.type !== stored.providerType) {
    throw new ProviderConfigurationError('INVALID_CONFIGURATION')
  }
  return result.data
}

export function providerSummary(
  stored: StoredProvider,
  history: ProviderSummary['history'],
): ProviderSummary {
  const result = providerTestResultSchema.safeParse(stored.lastTest)
  return {
    id: stored.id,
    name: stored.name,
    settings: settingsOf(stored),
    version: stored.version,
    credentialConfigured: Boolean(stored.encryptedCredential),
    enabled: stored.enabled,
    lastTest: result.success ? result.data : null,
    history,
  }
}
