import { termOperation } from '../../utils/term-catalog'

export default defineEventHandler((event) =>
  termOperation(event, (service) => service.list(getQuery(event))),
)
