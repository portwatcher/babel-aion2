import type { ProviderTestCode } from '@babel/contracts'

export class ProviderFailure extends Error {
  constructor(readonly code: Exclude<ProviderTestCode, 'PASS'>) {
    super(code)
  }
}
export function openaiFailure(status: number, code = '') {
  if (status === 401 || code === 'invalid_api_key') {
    return new ProviderFailure('INVALID_CREDENTIAL')
  }
  if (
    code === 'model_not_found' ||
    code === 'model_not_available' ||
    code === 'invalid_model'
  ) {
    return new ProviderFailure('MODEL_UNAVAILABLE')
  }
  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') {
    return new ProviderFailure('QUOTA_EXHAUSTED')
  }
  if (status === 403 || code === 'permission_denied') {
    return new ProviderFailure('PERMISSION_DENIED')
  }
  if (status === 429 || code === 'rate_limit_exceeded') {
    return new ProviderFailure('RATE_LIMITED')
  }
  if (status === 408) {
    return new ProviderFailure('TIMEOUT')
  }
  return new ProviderFailure(status === 400 ? 'INVALID_CONFIGURATION' : 'UNAVAILABLE')
}
