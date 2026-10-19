import { requireAdministratorSession } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const { identity } = await requireAdministratorSession(event)
  return { administrator: { email: identity.email } }
})
