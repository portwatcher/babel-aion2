import { administratorUserId } from '@babel/auth'
import { createTermService, TermCatalogError } from '@babel/database/terms'
import type { H3Event } from 'h3'
import { z } from 'zod'
import { requireAdministratorSession } from './auth'
import { useDatabase } from './database'
import { BodyInputError, readBoundedJson } from './bounded-json'

export async function termOperation<T>(
  event: H3Event,
  operation: (
    service: ReturnType<typeof createTermService>,
    actor: string,
  ) => Promise<T>,
) {
  const { identity } = await requireAdministratorSession(event)
  try {
    return await operation(
      createTermService(useDatabase(event)),
      administratorUserId(identity),
    )
  } catch (error) {
    if (error instanceof TermCatalogError) {
      const statuses = {
        NOT_FOUND: 404,
        VERSION_CONFLICT: 409,
        INVALID_TERM: 400,
        DUPLICATE_TERM: 409,
        VERSION_EXHAUSTED: 503,
      }
      throw createError({
        statusCode: statuses[error.code],
        statusMessage: error.code,
        data: { code: error.code },
      })
    }
    if (error instanceof BodyInputError) {
      throw createError({
        statusCode: error.code === 'TOO_LARGE' ? 413 : 400,
        statusMessage: 'Invalid term request',
        data: { code: 'INVALID_TERM' },
      })
    }
    throw createError({ statusCode: 503, statusMessage: 'Term catalog unavailable' })
  }
}
export function termId(event: H3Event) {
  const id = z.uuid().safeParse(getRouterParam(event, 'id'))
  if (!id.success) {
    throw new TermCatalogError('INVALID_TERM')
  }
  return id.data
}
export async function termBody<T>(event: H3Event, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await readBoundedJson(event, 32_768))
  if (!parsed.success) {
    throw new TermCatalogError('INVALID_TERM')
  }
  return parsed.data
}
