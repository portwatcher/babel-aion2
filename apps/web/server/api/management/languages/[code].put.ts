import { languageSaveSchema } from '@babel/contracts'
import {
  languageBody,
  languageOperation,
  outputCode,
} from '../../../utils/output-languages'

export default defineEventHandler((event) =>
  languageOperation(event, async (service, actor) =>
    service.save(
      outputCode(event),
      await languageBody(event, languageSaveSchema),
      actor,
    ),
  ),
)
