import { languageVersionSchema } from '@babel/contracts'
import {
  languageBody,
  languageOperation,
  outputCode,
} from '../../../utils/output-languages'

export default defineEventHandler((event) =>
  languageOperation(event, async (service, actor) =>
    service.remove(
      outputCode(event),
      (await languageBody(event, languageVersionSchema)).expectedVersion,
      actor,
    ),
  ),
)
