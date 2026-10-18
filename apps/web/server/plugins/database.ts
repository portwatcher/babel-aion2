import { createListenerService } from '@babel/database/listeners'
import { closeDatabase, useDatabase } from '../utils/database'
import {
  initializePlayerRuntime,
  stopPlayerRuntimeAdmission,
} from '../utils/runtime-owner'
import {
  playerListenerDelivery,
  startPlayerChannels,
  stopPlayerChannels,
} from '../utils/player-channel'

export default defineNitroPlugin(async (nitro) => {
  await initializePlayerRuntime()
  startPlayerChannels()
  let running: Promise<void> | undefined
  const timer = setInterval(() => {
    if (running || !useRuntimeConfig().databaseUrl) {
      return
    }
    // No overlapping sweeps. A quiet browser must be revoked before its public
    // list entry disappears; transport uncertainty remains DISCONNECTING.
    running = createListenerService(useDatabase(), playerListenerDelivery)
      .reconcile(new Date(Date.now() - 120_000))
      .catch(() => {
        console.error('listener_reconciliation_failed')
      })
      .finally(() => {
        running = undefined
      })
  }, 30_000)
  timer.unref()
  let stopping: Promise<void> | undefined
  function stop() {
    if (!stopping) {
      stopPlayerRuntimeAdmission()
      clearInterval(timer)
      // Nitro waits for connections to drain before its close hook. Begin
      // closing upgraded sockets at the signal, so they do not hold that wait.
      const closing = stopPlayerChannels()
      stopping = Promise.all([running, closing]).then(() => {})
    }
    return stopping
  }
  function onSignal() {
    void stop().catch(() => console.error('player_shutdown_unconfirmed'))
  }
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, onSignal)
  }
  nitro.hooks.hook('close', async () => {
    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.off(signal, onSignal)
    }
    await stop()
    await closeDatabase()
  })
})
