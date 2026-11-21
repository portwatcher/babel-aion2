import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import { once } from 'node:events'
import { test } from 'node:test'
import { portsBusy, portsReleased } from '../../../scripts/fixtures/media-worker.mjs'

test('candidate socket checks tolerate vanished transient bridge addresses while verifying live UDP sockets', async (t) => {
  const held = dgram.createSocket('udp4')
  t.after(() => {
    try {
      held.close()
    } catch {
      /* Already closed by the release assertion below. */
    }
  })
  held.bind(0, '127.0.0.1')
  await once(held, 'listening')
  const active = { address: '127.0.0.1', port: held.address().port }
  // RFC 5737 TEST-NET-2 is unconfigured locally and deterministically yields
  // EADDRNOTAVAIL, matching a torn-down Docker bridge on a shared CI host.
  const vanished = { address: '198.51.100.1', port: active.port }

  assert.equal(await portsBusy([active, vanished]), true)
  assert.equal(
    await portsBusy([vanished]),
    false,
    'all-vanished endpoints never manufacture a false busy proof',
  )
  assert.equal(await portsReleased([active, vanished]), false)

  await new Promise((resolve) => held.close(resolve))
  assert.equal(await portsBusy([active, vanished]), false)
  assert.equal(await portsReleased([active, vanished]), true)
})
