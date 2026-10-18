import { entryRequestSchema } from '@babel/contracts'

export default defineEventHandler(async (event) => {
  const request = entryRequestSchema.safeParse(await readBody(event))
  if (!request.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Invalid listener entry',
      data: request.error.flatten(),
    })
  }
  // Do not issue credentials before real media revocation can be confirmed.
  throw createError({
    statusCode: 503,
    statusMessage: '收听通道尚未接入，请稍后重试。',
  })
})
