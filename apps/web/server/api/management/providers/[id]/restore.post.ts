import { providerRestoreSchema } from '@babel/contracts'
import {
  providerBody,
  providerId,
  providerOperation,
} from '../../../../utils/provider-configuration'

export default defineEventHandler((event) =>
  providerOperation(event, async (service, actor) => {
    const input = await providerBody(event, providerRestoreSchema)
    return service.restore(
      providerId(event),
      input.expectedVersion,
      input.restoreVersion,
      actor,
    )
  }),
)
