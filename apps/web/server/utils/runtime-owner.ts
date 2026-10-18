import { randomUUID } from 'node:crypto'
import {
  registerRuntimeOwner,
  runtimeOwnerActive,
} from '@babel/database/runtime-owners'
import { useDatabase } from './database'

let ownerId: string | undefined
let stopping = false

export async function initializePlayerRuntime() {
  if (!useRuntimeConfig().databaseUrl) {
    return
  }
  if (import.meta.dev) {
    // Nuxt's development process is not supervised. Its receipts still require
    // actual socket closure; a development crash leaves an unknown owner.
    const id = randomUUID()
    await registerRuntimeOwner(useDatabase(), id)
    ownerId = id
    return
  }
  const id = process.env.BABEL_RUNTIME_OWNER_ID
  if (
    !process.connected ||
    !id ||
    !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/.test(id) ||
    !(await runtimeOwnerActive(useDatabase(), id))
  ) {
    throw new Error('Player runtime requires its supervisor')
  }
  ownerId = id
}

export function playerRuntimeOwner() {
  if (!ownerId) {
    throw new Error('Player runtime is unavailable')
  }
  return ownerId
}

export async function playerRuntimeReady() {
  if (!ownerId || stopping) {
    return false
  }
  const active = await runtimeOwnerActive(useDatabase(), ownerId)
  return active && !stopping
}

export function stopPlayerRuntimeAdmission() {
  stopping = true
}
