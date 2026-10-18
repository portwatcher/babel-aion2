import { termVersionSchema } from '@babel/contracts'
import { termBody, termId, termOperation } from '../../../utils/term-catalog'

export default defineEventHandler((event) =>
  termOperation(event, async (service, actor) =>
    service.remove(
      termId(event),
      (await termBody(event, termVersionSchema)).expectedVersion,
      actor,
    ),
  ),
)
