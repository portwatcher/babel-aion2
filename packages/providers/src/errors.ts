import type { ProviderTestCode } from '@babel/contracts'

export class ProviderFailure extends Error {
  constructor(readonly code: Exclude<ProviderTestCode, 'PASS'>) {
    super(code)
  }
}

export function sonioxFailure(status: number, type?: string) {
  if (status === 401) {
    return new ProviderFailure('INVALID_CREDENTIAL')
  }
  if (type === 'model_not_available') {
    return new ProviderFailure('MODEL_UNAVAILABLE')
  }
  if (status === 402) {
    return new ProviderFailure('QUOTA_EXHAUSTED')
  }
  if (status === 403) {
    return new ProviderFailure('PERMISSION_DENIED')
  }
  if (status === 429) {
    return new ProviderFailure('RATE_LIMITED')
  }
  if (status === 408) {
    return new ProviderFailure('TIMEOUT')
  }
  return new ProviderFailure(status === 400 ? 'INVALID_CONFIGURATION' : 'UNAVAILABLE')
}
