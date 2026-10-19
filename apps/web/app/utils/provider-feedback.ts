import { providerTestCodeSchema, type ProviderTestCode } from '@babel/contracts'
import { managementFailure } from './management-errors'

const labels: Record<ProviderTestCode, string> = {
  PASS: 'Connection test passed',
  INVALID_CREDENTIAL: 'Invalid credential',
  MODEL_UNAVAILABLE: 'Model unavailable',
  QUOTA_EXHAUSTED: 'Quota exhausted',
  RATE_LIMITED: 'Rate limited',
  PERMISSION_DENIED: 'Insufficient credential permissions',
  INVALID_CONFIGURATION: 'Service rejected these settings',
  TIMEOUT: 'Connection test timed out',
  UNAVAILABLE: 'Service temporarily unavailable',
  INVALID_RESPONSE: 'Incomplete service response',
  CONTEXT_TOO_LARGE:
    'Terminology context too large. Disable some terms or turn off terminology hints for this sample',
}
export const providerTestLabel = (code: ProviderTestCode) => labels[code]

export function providerFailure(error: unknown) {
  const details =
    error && typeof error === 'object' && 'data' in error ? error.data : null
  const data =
    details && typeof details === 'object' && 'data' in details ? details.data : null
  if (data && typeof data === 'object' && 'code' in data) {
    if (data.code === 'INVALID_AUDIO') {
      return 'Check the language code and select a 0.2–10 second mono 16-bit PCM WAV at 16 or 48 kHz.'
    }
    if (data.code === 'REQUEST_TOO_LARGE') {
      return 'Sample too large. Select a WAV no larger than 1 MB.'
    }
    if (data.code === 'TERMINOLOGY_CHANGED') {
      return 'Terminology changed during processing. Test the current version again.'
    }
    if (data.code === 'CONNECTION_TEST_FAILED' && 'testCode' in data) {
      const code = providerTestCodeSchema.safeParse(data.testCode)
      if (code.success) {
        return `${providerTestLabel(code.data)}. The previous configuration is unchanged.`
      }
    }
    if (data.code === 'TEST_IN_PROGRESS') {
      return 'A connection test is already running for this configuration. Try again later.'
    }
    if (data.code === 'TEST_COOLDOWN') {
      return 'Wait at least 10 seconds after the previous test started before retrying.'
    }
    if (data.code === 'PROVIDER_IN_USE') {
      return 'A language path still references this configuration. Remove the reference first.'
    }
    if (data.code === 'TYPE_IMMUTABLE') {
      return 'Provider type cannot change. Add a separate configuration.'
    }
  }
  return managementFailure(error)
}
