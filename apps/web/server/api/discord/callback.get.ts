import {
  hashInstallationSecret,
  readInstallation,
  completeInstallation,
} from '@babel/database/community-rooms'
import {
  installationConfiguration,
  installationCookie,
} from '../../utils/community-rooms'
import { authorizeInstallation } from '../../services/discord-installation'
import { useDatabase } from '../../utils/database'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  try {
    const config = installationConfiguration(event)
    const { id, browser } = installationCookie(event)
    const query = getQuery(event)
    if (
      typeof query.state !== 'string' ||
      typeof query.code !== 'string' ||
      query.code.length > 2048
    ) {
      throw new Error('Invalid callback')
    }
    const database = useDatabase(event)
    const installation = await readInstallation(database, id, browser)
    if (
      installation.authorizedAt ||
      installation.stateHash !== hashInstallationSecret(query.state)
    ) {
      throw new Error('Invalid state')
    }
    const identity = await authorizeInstallation(config, query.code)
    await completeInstallation(database, id, browser, query.state, identity)
    return sendRedirect(event, '/rooms/create?installed=1', 303)
  } catch {
    return sendRedirect(event, '/rooms/create?installationError=1', 303)
  }
})
