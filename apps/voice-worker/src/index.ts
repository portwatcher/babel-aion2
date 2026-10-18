import { createMediaNetwork } from './media-network.ts'
import { superviseWorker } from './supervisor.ts'

const databaseUrl = process.env.DATABASE_URL
const secret = process.env.MEDIA_CONTROL_SECRET
const port = Number(process.env.MEDIA_CONTROL_PORT ?? '3100')

if (!databaseUrl || !secret) {
  console.log(
    'Babel worker: STOPPED — configure database and private media control before starting.',
  )
} else if (secret.length < 32 || !Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('Babel worker configuration is invalid.')
  process.exitCode = 1
} else {
  try {
    createMediaNetwork(process.env)
    await superviseWorker(databaseUrl)
  } catch {
    console.error('Babel worker configuration is invalid.')
    process.exitCode = 1
  }
}
