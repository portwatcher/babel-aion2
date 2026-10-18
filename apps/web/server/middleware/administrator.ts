import { isAdministratorPath } from '@babel/auth/access'
import { requireAdministrator } from '../utils/auth'

export default defineEventHandler(async (event) => {
  let protectedPath: boolean
  try {
    protectedPath = isAdministratorPath(getRequestURL(event).pathname)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Invalid request path' })
  }
  if (protectedPath) {
    await requireAdministrator(event)
  }
})
