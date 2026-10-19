import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createDatabase } from '../src/client.ts'
import { confirmRuntimeExit, registerRuntimeOwner } from '../src/runtime-owners.ts'
import {
  requestedRuntimePodRetirements,
  RuntimePodRetirementRequired,
  sealRuntimePod,
} from '../src/runtime-pods.ts'

test('Pod admission commits retirement on supervisor replacement and fences delayed owners without closing another Pod', async (t) => {
  assert.ok(process.env.DATABASE_URL)
  assert.ok(
    ['localhost', '127.0.0.1', '[::1]'].includes(
      new URL(process.env.DATABASE_URL).hostname,
    ),
  )
  const database = createDatabase(process.env.DATABASE_URL)
  const namespace = `pod-proof-${randomUUID().slice(0, 8)}`
  const first = { uid: randomUUID(), name: 'runtime', namespace }
  const next = { ...first, uid: randomUUID() }
  const pending = { ...first, uid: randomUUID(), name: 'pending' }
  const owner = randomUUID(),
    replacement = randomUUID(),
    other = randomUUID()
  t.after(async () => {
    await database.pool.query('delete from runtime_owner where pod_uid=any($1)', [
      [first.uid, next.uid, pending.uid],
    ])
    await database.pool.query('delete from runtime_pod where namespace=$1', [namespace])
    await database.close()
  })
  await registerRuntimeOwner(database.db, owner, first)
  // A response lost after commit must be safe to retry with the same incarnation.
  await registerRuntimeOwner(database.db, owner, first)
  assert.deepEqual(await requestedRuntimePodRetirements(database.db, namespace), [])
  await registerRuntimeOwner(database.db, other, next)
  await assert.rejects(
    registerRuntimeOwner(database.db, replacement, first),
    RuntimePodRetirementRequired,
  )
  assert.deepEqual(await requestedRuntimePodRetirements(database.db, namespace), [
    first,
  ])
  assert.deepEqual(
    await requestedRuntimePodRetirements(database.db, `${namespace}-other`),
    [],
  )
  assert.equal(await sealRuntimePod(database.db, first), false)
  assert.equal(
    (
      await database.pool.query('select exited_at from runtime_owner where id=$1', [
        owner,
      ])
    ).rows[0].exited_at,
    null,
  )
  assert.equal(
    (
      await database.pool.query(
        'select count(*)::int as count from runtime_owner where id=$1',
        [replacement],
      )
    ).rows[0].count,
    0,
  )
  // This is a storage contract, not a fabricated Pod termination receipt.
  // The Kubernetes smoke test owns whole-container physical-exit proof.
  await confirmRuntimeExit(database.db, owner)
  assert.equal(await sealRuntimePod(database.db, first), true)
  await assert.rejects(
    registerRuntimeOwner(database.db, replacement, first),
    RuntimePodRetirementRequired,
  )
  assert.equal(
    (
      await database.pool.query('select exited_at from runtime_owner where id=$1', [
        other,
      ])
    ).rows[0].exited_at,
    null,
  )

  // A deleting Pod that has not reserved a runtime cannot admit one after sealing.
  assert.equal(await sealRuntimePod(database.db, pending), true)
  await assert.rejects(
    registerRuntimeOwner(database.db, randomUUID(), pending),
    RuntimePodRetirementRequired,
  )
  await assert.rejects(
    registerRuntimeOwner(database.db, randomUUID(), { ...next, name: 'different' }),
  )
})
