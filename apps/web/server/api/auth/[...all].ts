import { requireAdministrator, useAdministratorAuth } from '../../utils/auth'

const methods: Record<string, string> = {
  '/api/auth/get-session': 'GET',
  '/api/auth/sign-in/cloudflare': 'POST',
  '/api/auth/sign-out': 'POST',
}

export default defineEventHandler(async (event) => {
  await requireAdministrator(event)
  const path = getRequestURL(event).pathname.replace(/\/$/, '')
  if (methods[path] !== event.method) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Auth operation not available',
    })
  }
  return useAdministratorAuth(event).handler(toWebRequest(event))
})
