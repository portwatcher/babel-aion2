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
  // H3 gives every POST a stream, including an empty request. Better Auth then
  // requires a media type for that artificial body. Preserve an absent body.
  const request =
    event.method === 'POST'
      ? new Request(getRequestURL(event), {
          method: event.method,
          headers: event.headers,
          body: (await readRawBody(event)) || undefined,
        })
      : toWebRequest(event)
  return useAdministratorAuth(event).handler(request)
})
