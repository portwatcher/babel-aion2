import { requireAdministrator } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const identity = await requireAdministrator(event)
  return { email: identity.email }
})
