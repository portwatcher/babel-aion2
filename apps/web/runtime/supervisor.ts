import { superviseRuntime } from '@babel/processes'
import { databasePoolSize } from '@babel/database'

const databaseUrl = process.env.NUXT_DATABASE_URL
if (databaseUrl) {
  try {
    databasePoolSize(process.env.NUXT_DATABASE_POOL_MAX)
    await superviseRuntime({
      databaseUrl,
      moduleUrl: new URL('./runtime.mjs', import.meta.url),
      component: 'web',
    })
  } catch {
    console.error('Babel web supervisor could not start.')
    process.exitCode = 1
  }
} else {
  // An unconfigured lobby has no database-backed player transports to own.
  // Keep the public page and fail-closed configuration/health responses available.
  await import(new URL('./index.mjs', import.meta.url).href)
}
