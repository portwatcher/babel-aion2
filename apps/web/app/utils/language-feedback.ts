import type { ManagedLanguage } from '@babel/contracts'
import { providerFailure, providerTestLabel } from './provider-feedback'

export function languageValidationLabel(language: ManagedLanguage) {
  return {
    NOT_TESTED: 'Sample path not validated',
    CURRENT: 'Current sample path validated',
    STALE: 'Configuration changed; validation required',
  }[language.validationState]
}

export function languageAttemptLabel(language: ManagedLanguage) {
  const code = language.lastAttempt?.code
  return code === 'PASS'
    ? 'Sample path passed'
    : code === 'NO_SPEECH'
      ? 'No stable speech detected'
      : code
        ? providerTestLabel(code)
        : 'Not tested'
}

export function languageFailure(error: unknown) {
  const details =
    error && typeof error === 'object' && 'data' in error ? error.data : null
  const data =
    details && typeof details === 'object' && 'data' in details ? details.data : null
  if (data && typeof data === 'object' && 'code' in data) {
    switch (data.code) {
      case 'INVALID_LANGUAGE':
        return 'Check the language code, name and required configurations.'
      case 'INVALID_PATH':
        return 'Save a valid OpenAI API Key first.'
      case 'PATH_UNVALIDATED':
        return 'Validate the current language path with an authorized sample first.'
      case 'DELIVERY_UNAVAILABLE':
        return 'Player subtitle delivery is unavailable. Languages cannot be enabled yet.'
      case 'LANGUAGE_ENABLED':
        return 'Disable this language before changing its path or deleting it.'
      case 'VERSION_CONFLICT':
        return 'Language or provider configuration changed. Reload and retry.'
      case 'NOT_FOUND':
        return 'This language or configuration no longer exists. Reload the list.'
    }
  }
  return providerFailure(error)
}
