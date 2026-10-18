import { termSaveSchema } from '@babel/contracts'
import { termBody, termId, termOperation } from '../../../utils/term-catalog'

export default defineEventHandler((event) =>
  termOperation(event, async (service, actor) =>
    service.save(termId(event), await termBody(event, termSaveSchema), actor),
  ),
)
