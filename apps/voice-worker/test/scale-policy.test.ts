import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  computeVoiceScaleMetrics,
  parseBurstScalePolicy,
  parseFanoutOnly,
} from '../src/scale-policy.ts'

test('parseFanoutOnly accepts boolean strings and rejects unknown values', () => {
  assert.equal(parseFanoutOnly(undefined), false)
  assert.equal(parseFanoutOnly(''), false)
  assert.equal(parseFanoutOnly('false'), false)
  assert.equal(parseFanoutOnly('0'), false)
  assert.equal(parseFanoutOnly('true'), true)
  assert.equal(parseFanoutOnly('1'), true)
  assert.equal(parseFanoutOnly(' TRUE '), true)
  assert.throws(() => parseFanoutOnly('yes'))
  assert.throws(() => parseFanoutOnly('2'))
})

test('parseBurstScalePolicy applies defaults and validates bounds', () => {
  assert.deepEqual(parseBurstScalePolicy({}), {
    activationListeners: 15,
    listenersPerReplica: 250,
  })
  assert.deepEqual(
    parseBurstScalePolicy({
      SCALE_BURST_ACTIVATION_LISTENERS: '20',
      SCALE_BURST_LISTENERS_PER_REPLICA: '300',
    }),
    {
      activationListeners: 20,
      listenersPerReplica: 300,
    },
  )
  assert.throws(() => parseBurstScalePolicy({ SCALE_BURST_ACTIVATION_LISTENERS: '0' }))
  assert.throws(() =>
    parseBurstScalePolicy({ SCALE_BURST_LISTENERS_PER_REPLICA: '-5' }),
  )
  assert.throws(() =>
    parseBurstScalePolicy({ SCALE_BURST_LISTENERS_PER_REPLICA: '12.5' }),
  )
})

test('computeVoiceScaleMetrics scales burst replicas from active listeners', () => {
  const policy = { activationListeners: 15, listenersPerReplica: 250 }

  assert.deepEqual(
    computeVoiceScaleMetrics(
      {
        activeSessions: 14,
        openMediaConnections: 10,
        activeVoiceSources: 1,
        activeFanoutWorkers: 0,
      },
      policy,
    ),
    {
      activeSessions: 14,
      openMediaConnections: 10,
      activeListeners: 14,
      activeVoiceSources: 1,
      activeFanoutWorkers: 0,
      desiredBurstReplicas: 0,
    },
  )

  assert.equal(
    computeVoiceScaleMetrics(
      {
        activeSessions: 15,
        openMediaConnections: 12,
        activeVoiceSources: 1,
        activeFanoutWorkers: 0,
      },
      policy,
    ).desiredBurstReplicas,
    1,
  )

  // Uses whichever of active sessions or open media connections is higher.
  assert.equal(
    computeVoiceScaleMetrics(
      {
        activeSessions: 240,
        openMediaConnections: 251,
        activeVoiceSources: 2,
        activeFanoutWorkers: 1,
      },
      policy,
    ).desiredBurstReplicas,
    2,
  )

  assert.equal(
    computeVoiceScaleMetrics(
      {
        activeSessions: 751,
        openMediaConnections: 740,
        activeVoiceSources: 3,
        activeFanoutWorkers: 3,
      },
      policy,
    ).desiredBurstReplicas,
    4,
  )
})
