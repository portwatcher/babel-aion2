import { requireAdministratorSession } from '../../utils/auth'

export default defineEventHandler(async (event) => {
  const { identity } = await requireAdministratorSession(event)
  return {
    administrator: { email: identity.email },
    services: {
      discord: 'NOT_IMPLEMENTED',
      media: 'NOT_IMPLEMENTED',
      subtitles: 'NOT_IMPLEMENTED',
    },
    availableProviders: [],
    configurationEditable: true,
  }
})
