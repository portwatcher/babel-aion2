import { providerSaveSchema } from '@babel/contracts'
import {
  providerBody,
  providerId,
  providerOperation,
} from '../../../utils/provider-configuration'

export default defineEventHandler((event) =>
  providerOperation(event, async (service, actor) =>
    service.save(
      providerId(event),
      await providerBody(event, providerSaveSchema),
      actor,
    ),
  ),
)
