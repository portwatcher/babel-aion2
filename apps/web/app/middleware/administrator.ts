export default defineNuxtRouteMiddleware(async () => {
  try {
    const identity = await useRequestFetch()('/api/management/identity')
    useState('administrator-identity', () => identity).value = identity
  } catch {
    throw createError({
      statusCode: 403,
      statusMessage: 'Administrator access required',
      message: '管理入口暂不可用。请通过已配置的 Cloudflare Access 入口重新登录。',
    })
  }
})
