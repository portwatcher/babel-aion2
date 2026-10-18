import { languageStateSchema } from '@babel/contracts'
import {
  languageBody,
  languageOperation,
  outputCode,
} from '../../../../utils/output-languages'

export default defineEventHandler((event) =>
  languageOperation(event, async (service, actor) => {
    const input = await languageBody(event, languageStateSchema)
    return service.state(outputCode(event), input.expectedVersion, input.enabled, actor)
  }),
)
