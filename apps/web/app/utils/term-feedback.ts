import { managementFailure } from './management-errors'

export function termFailure(error: unknown) {
  const response =
    error && typeof error === 'object' && 'data' in error ? error.data : null
  const details =
    response && typeof response === 'object' && 'data' in response
      ? response.data
      : null
  const code =
    details && typeof details === 'object' && 'code' in details ? details.code : null
  if (code === 'DUPLICATE_TERM') {
    return 'This source term or alias already exists for the source language. Edit the existing entry.'
  }
  if (code === 'INVALID_TERM') {
    return 'Check term content and language codes. Source terms and aliases must be unique, with one expression per output language.'
  }
  if (code === 'NOT_FOUND') {
    return 'This term no longer exists. Reload the catalog.'
  }
  return managementFailure(error)
}
