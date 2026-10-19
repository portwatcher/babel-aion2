export default defineNuxtRouteMiddleware(async () => {
  try {
    const identity = await useRequestFetch()('/api/management/identity')
    useState('administrator-identity', () => identity).value = identity
  } catch {
    throw createError({
      statusCode: 403,
      statusMessage: 'Administrator access required',
      message:
        'Administration is unavailable. Sign in again through the configured Cloudflare Access entry.',
    })
  }
})
