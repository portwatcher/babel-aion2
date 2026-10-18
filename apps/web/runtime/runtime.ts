import { receiveRuntimeOwner } from '@babel/processes'

try {
  const ownerId = await receiveRuntimeOwner()
  // Private server bootstrap state, never part of runtimeConfig or browser data.
  process.env.BABEL_RUNTIME_OWNER_ID = ownerId
  process.once('disconnect', () => process.kill(process.pid, 'SIGTERM'))
  await import(new URL('./index.mjs', import.meta.url).href)
  console.log(
    JSON.stringify({ webRuntimeStarted: true, runtimePid: process.pid, ownerId }),
  )
} catch {
  console.error('Babel web runtime could not start.')
  process.exit(1)
}
