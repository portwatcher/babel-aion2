import { providerVersionSchema } from '@babel/contracts'
import {
  providerBody,
  providerId,
  providerOperation,
} from '../../../utils/provider-configuration'

export default defineEventHandler((event) =>
  providerOperation(event, async (service, actor) => {
    const input = await providerBody(event, providerVersionSchema)
    await service.remove(providerId(event), input.expectedVersion, actor)
    return { removed: true }
  }),
)
