import { providerOperation } from '../../utils/provider-configuration'
import { roomCredentialCipher } from '../../utils/management-configuration'

export default defineEventHandler((event) =>
  providerOperation(event, async (service) => ({
    configurations: await service.list(),
    credentialProtectionReady: roomCredentialCipher(event) !== null,
  })),
)
