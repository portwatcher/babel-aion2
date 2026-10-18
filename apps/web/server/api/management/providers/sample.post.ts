import { providerSampleRequestSchema } from '@babel/contracts'
import { providerOperation } from '../../../utils/provider-configuration'
import { readSampleBody, runProviderSample } from '../../../utils/provider-sample'

export default defineEventHandler((event) =>
  providerOperation(event, async (service, actor) =>
    runProviderSample(
      event,
      service,
      actor,
      await readSampleBody(event, providerSampleRequestSchema),
    ),
  ),
)
