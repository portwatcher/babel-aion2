import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { until } from './media-worker.mjs'

// Distinct from coordinator tests: the built web timer must run autonomously,
// and both replicas must close public and management HTTP access afterwards.
export async function verifyRoomDisband({
  database,
  create,
  call,
  a,
  b,
  administrator,
}) {
  const { roomId, roomNumber } = await create(
    'Unused room timeout',
    'siel',
    [],
    'alpha',
    true,
  )
  await database.pool.query(
    "update community_room set created_at=now()-interval '5 minutes 1 second' where room_id=$1",
    [roomId],
  )
  await until(
    async () => {
      const { rows } = await database.pool.query(
        'select disbanded_at from room where id=$1',
        [roomId],
      )
      return rows[0].disbanded_at !== null
    },
    'automatic empty-room disband',
    45_000,
  )
  for (const server of [a, b]) {
    const directory = await (await call(server, '/api/player/rooms')).json()
    assert.ok(!directory.rooms.some((room) => room.id === roomId))
    for (const path of ['config', 'players']) {
      assert.equal(
        (await call(server, `/api/player/rooms/${roomNumber}/${path}`)).status,
        404,
      )
    }
    assert.equal(
      (
        await call(server, `/api/player/rooms/${roomNumber}/sessions`, {
          method: 'POST',
          token: randomBytes(32).toString('base64url'),
          body: { nickname: 'Pilot', outputLanguage: null, requestId: randomUUID() },
        })
      ).status,
      404,
    )
    const response = await fetch(
      `${server.origin}/api/management/room?roomId=${roomId}`,
      {
        headers: {
          'cf-access-jwt-assertion': administrator.jwt,
          cookie: administrator.cookie,
        },
      },
    )
    assert.equal(response.status, 404)
  }
  console.log(
    'PASS autonomous room timeout: built web timer disbands an empty room; directory, configuration, players, entry and administrator settings reject it across replicas.',
  )
}
