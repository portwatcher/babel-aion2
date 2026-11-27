import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rankWorkersByLoad } from '../server/utils/media-control.ts'

test('rankWorkersByLoad prefers fan-out burst workers ahead of base source owners', () => {
  const baseOnly = rankWorkersByLoad([
    {
      ownerId: 'base-a',
      controlUrl: 'http://10.0.0.1:3100',
      activeConnections: 40,
      fanoutOnly: false,
    },
    {
      ownerId: 'base-b',
      controlUrl: 'http://10.0.0.2:3100',
      activeConnections: 10,
      fanoutOnly: false,
    },
  ])
  assert.deepEqual(baseOnly, ['http://10.0.0.2:3100', 'http://10.0.0.1:3100'])

  const mixed = rankWorkersByLoad([
    {
      ownerId: 'base-a',
      controlUrl: 'http://10.0.0.1:3100',
      activeConnections: 0,
      fanoutOnly: false,
    },
    {
      ownerId: 'burst-busy',
      controlUrl: 'http://10.0.0.3:3100',
      activeConnections: 80,
      fanoutOnly: true,
    },
    {
      ownerId: 'burst-light',
      controlUrl: 'http://10.0.0.4:3100',
      activeConnections: 20,
      fanoutOnly: true,
    },
  ])
  assert.deepEqual(mixed, [
    'http://10.0.0.4:3100',
    'http://10.0.0.3:3100',
    'http://10.0.0.1:3100',
  ])
})
