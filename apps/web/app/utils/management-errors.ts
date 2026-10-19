export function managementFailure(error: unknown) {
  const status =
    error && typeof error === 'object' && 'statusCode' in error
      ? error.statusCode
      : null
  if (status === 409) {
    return 'Configuration changed elsewhere. Reload before submitting changes.'
  }
  if (status === 401 || status === 403) {
    return 'Administrator session expired. Sign in again through Access.'
  }
  if (status === 400) {
    return 'Check the settings. The server did not save these changes.'
  }
  return 'The result is unconfirmed. Reload to check the saved state.'
}
