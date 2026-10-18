import { languageMoveSchema } from '@babel/contracts'
import {
  languageBody,
  languageOperation,
  outputCode,
} from '../../../../utils/output-languages'

export default defineEventHandler((event) =>
  languageOperation(event, async (service, actor) => {
    const input = await languageBody(event, languageMoveSchema)
    return service.move(
      outputCode(event),
      input.expectedCatalogVersion,
      input.direction,
      actor,
    )
  }),
)
