import {
  createListenerService,
  unavailableListenerDelivery,
} from '@babel/database/listeners'
import { closeDatabase, useDatabase } from '../utils/database'

export default defineNitroPlugin((nitro) => {
  let running: Promise<void> | undefined
  const timer = setInterval(() => {
    if (running || !useRuntimeConfig().databaseUrl) {
      return
    }
    // No overlapping sweeps. A quiet browser must be revoked before its public
    // list entry disappears; transport uncertainty remains DISCONNECTING.
    running = createListenerService(useDatabase(), unavailableListenerDelivery)
      .reconcile(new Date(Date.now() - 120_000))
      .catch(() => {
        console.error('listener_reconciliation_failed')
      })
      .finally(() => {
        running = undefined
      })
  }, 30_000)
  timer.unref()
  nitro.hooks.hook('close', async () => {
    clearInterval(timer)
    await running
    await closeDatabase()
  })
})
