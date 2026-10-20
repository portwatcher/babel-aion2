// Capacity check: N listeners across R player-source rooms against the built web
// replicas, the built voice worker and PostgreSQL. Each room host publishes a
// tone through its WebRTC uplink; every other listener must keep receiving the
// room mix while its player WebSocket stays authenticated.
//
//   node --env-file=.env scripts/capacity-smoke.mjs [listeners] [rooms] [seconds]
//
// Environment: CAPACITY_PROCESSES (listener processes), MEDIA_WORKER_THREADS,
// CAPACITY_TURN_SECRET (relay all media through a TURN server on 127.0.0.1:3478),
// MEDIA_OPUS_FRAME_MS. On Linux, CAPACITY_WORKER_CPUS and CAPACITY_WEB_CPUS
// (taskset lists such as "0,1"; one per web replica, separated by /) pin the
// runtimes like container CPU limits.
import assert from 'node:assert/strict'
import { execFile, fork } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import pg from 'pg'
import { startTestServer } from './test-server.mjs'
import { startMediaWorker, until } from './fixtures/media-worker.mjs'

const exec = promisify(execFile)
const total = Number(process.argv[2] ?? 1000)
const roomCount = Number(process.argv[3] ?? 5)
const seconds = Number(process.argv[4] ?? 60)
const processCount = Number(process.env.CAPACITY_PROCESSES ?? 10)
const packetMs = Number(process.env.MEDIA_OPUS_FRAME_MS ?? 60)
const databaseUrl = process.env.DATABASE_URL
assert.ok(databaseUrl, 'Use disposable PostgreSQL')
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname))

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 })
const secret = randomBytes(32).toString('base64url')
const tag = randomBytes(3).toString('hex')
const rooms = []
const children = []
let index
let worker
let servers = []

// Every character exists on the room's server in this fixture index.
async function startIndex() {
  const server = createServer((request, response) => {
    const name = new URL(request.url, 'http://127.0.0.1').searchParams.get('q') ?? ''
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        suggestions: [
          {
            name,
            href: `/c/as/siel/${encodeURIComponent(name)}`,
            region: 'as',
            server: 'Siel',
            className: 'Ranger',
            level: 45,
          },
        ],
      }),
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server
}

/** Pins every thread of a process to a CPU list (Linux taskset). */
async function pin(pid, cpus) {
  if (cpus) {
    await exec('taskset', ['-a', '-p', '-c', cpus, String(pid)])
  }
}

/** Cumulative CPU seconds of a process and its threads. */
async function cpuSeconds(pid) {
  const { stdout } = await exec('ps', ['-o', 'time=', '-p', String(pid)])
  const parts = stdout.trim().replace('-', ':').split(':').map(Number)
  return parts.reduce((sum, value) => sum * 60 + value, 0)
}

async function transactions() {
  const { rows } = await pool.query(
    'select xact_commit + xact_rollback as count from pg_stat_database where datname = current_database()',
  )
  return Number(rows[0].count)
}

function request(child, type) {
  return new Promise((resolve) => {
    child.once('message', resolve)
    child.send({ type })
  })
}

async function report() {
  const reports = await Promise.all(children.map((child) => request(child, 'report')))
  const sum = {}
  for (const item of reports) {
    for (const [key, value] of Object.entries(item.totals)) {
      if (key === 'reasons') {
        sum.reasons ??= {}
        for (const [reason, n] of Object.entries(value)) {
          sum.reasons[reason] = (sum.reasons[reason] ?? 0) + n
        }
      } else {
        sum[key] = (sum[key] ?? 0) + value
      }
    }
  }
  return { totals: sum, packets: reports.flatMap((item) => item.packets) }
}

try {
  for (let number = 0; number < roomCount; number += 1) {
    const host = `Host${tag}${number}`
    const { rows } = await pool.query(
      `insert into room(name, stopped, audio_source, host_character_id)
       values ($1, false, 'PLAYER', $2) returning id`,
      [`Capacity ${tag} ${number}`, host],
    )
    const { rows: admission } = await pool.query(
      `insert into community_room(room_id, server) values ($1, 'siel') returning number`,
      [rows[0].id],
    )
    rooms.push({ id: rows[0].id, number: admission[0].number, host })
  }
  index = await startIndex()
  worker = await startMediaWorker(databaseUrl, secret, undefined, {
    DATABASE_POOL_MAX: '2',
    MEDIA_WORKER_THREADS: process.env.MEDIA_WORKER_THREADS ?? '2',
    MEDIA_OPUS_FRAME_MS: String(packetMs),
    // Production shape: worker over TURN/TCP, players over TURN/UDP, relay only.
    ...(process.env.CAPACITY_TURN_SECRET
      ? {
          MEDIA_TURN_URLS: JSON.stringify([
            'turn:127.0.0.1:3478?transport=udp',
            'turn:127.0.0.1:3478?transport=tcp',
          ]),
          MEDIA_WORKER_TURN_URL: 'turn:127.0.0.1:3478?transport=tcp',
          MEDIA_TURN_SHARED_SECRET: process.env.CAPACITY_TURN_SECRET,
          MEDIA_ICE_POLICY: 'relay',
          MEDIA_BROWSER_ICE_POLICY: 'relay',
        }
      : {}),
  })
  const environment = {
    NUXT_MEDIA_CONTROL_URL: worker.origin,
    NUXT_MEDIA_CONTROL_SECRET: secret,
    NUXT_DATABASE_POOL_MAX: '3',
    BABEL_TEST_COMMUNITY_ORIGIN: `http://127.0.0.1:${index.address().port}`,
  }
  const nodeImports = ['./scripts/fixtures/community-network.mjs']
  servers = await Promise.all(
    [0, 1].map(() => startTestServer(databaseUrl, { environment, nodeImports })),
  )
  await pin(worker.runtime().pid, process.env.CAPACITY_WORKER_CPUS)
  const webCpus = process.env.CAPACITY_WEB_CPUS?.split('/') ?? []
  await Promise.all(servers.map((server, i) => pin(server.runtime().pid, webCpus[i])))
  await until(
    async () =>
      (
        await fetch(`${worker.origin}/ready`, {
          headers: { authorization: `Bearer ${secret}` },
        })
      ).status === 200,
    'worker ready',
    30_000,
  )

  const plan = Array.from({ length: processCount }, () => [])
  // Hosts first, so every room has an audio source before its members join.
  const people = [
    ...rooms.map((room) => ({ room, nickname: room.host, host: true })),
    ...Array.from({ length: total - roomCount }, (_, i) => ({
      room: rooms[i % roomCount],
      nickname: `L${tag}${i}`,
      host: false,
    })),
  ]
  people.forEach((person, i) => {
    plan[i % processCount].push({
      origin: servers[i % servers.length].origin,
      roomNumber: person.room.number,
      nickname: person.nickname,
      host: person.host,
    })
  })
  const joinRate = Number(process.env.CAPACITY_JOIN_RATE ?? 25)
  const started = Date.now()
  for (const listeners of plan) {
    const child = fork(new URL('./fixtures/capacity-listeners.mjs', import.meta.url), {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    children.push(child)
    child.send({
      type: 'start',
      listeners,
      joinIntervalMs: (1000 * processCount) / joinRate,
    })
  }
  const receivers = total - roomCount
  await until(
    async () => {
      const { totals } = await report()
      process.stdout.write(
        `\rjoined ${totals.entered}/${total} sockets ${totals.sockets} audio ${totals.connected} errors ${JSON.stringify(totals.reasons ?? {})}   `,
      )
      return totals.connected >= total * 0.995 && totals.sockets >= total * 0.995
    },
    'listeners connected',
    (total / joinRate) * 1000 + 120_000,
  )
  const rampSeconds = (Date.now() - started) / 1000
  process.stdout.write('\n')
  await delay(5_000)

  const pids = {
    worker: worker.runtime().pid,
    web: servers.map((server) => server.runtime().pid),
  }
  const before = {
    at: Date.now(),
    report: await report(),
    worker: await cpuSeconds(pids.worker),
    web: await Promise.all(pids.web.map(cpuSeconds)),
    transactions: await transactions(),
  }
  await delay(seconds * 1000)
  const after = {
    at: Date.now(),
    report: await report(),
    worker: await cpuSeconds(pids.worker),
    web: await Promise.all(pids.web.map(cpuSeconds)),
    transactions: await transactions(),
  }
  const elapsed = (after.at - before.at) / 1000
  const sources = await Promise.all(
    rooms.map(async (room) => {
      const status = await (await worker.control('/source', { roomId: room.id })).json()
      return {
        state: status.state,
        hostFrames: status.speakers?.[0]?.receivedFrames ?? 0,
      }
    }),
  )
  const rates = after.report.packets
    .map((count, i) => (count - before.report.packets[i]) / elapsed)
    .sort((a, b) => a - b)
  const result = {
    listeners: total,
    rooms: roomCount,
    mediaThreads: Number(process.env.MEDIA_WORKER_THREADS ?? 2),
    packetMs,
    relay: Boolean(process.env.CAPACITY_TURN_SECRET),
    rampSeconds: Number(rampSeconds.toFixed(1)),
    sources,
    steadySeconds: Number(elapsed.toFixed(1)),
    connectedAudio: after.report.totals.connected,
    authenticatedSockets: after.report.totals.sockets,
    socketClosures: after.report.totals.socketClosures,
    peerFailures: after.report.totals.peerFailures,
    rampRenegotiations: before.report.totals.renegotiations,
    steadyRenegotiations:
      after.report.totals.renegotiations - before.report.totals.renegotiations,
    reasons: after.report.totals.reasons,
    entryRetries: after.report.totals.errors,
    packetsPerListener: {
      min: Number(rates[0].toFixed(1)),
      p01: Number(rates[Math.floor(rates.length * 0.01)].toFixed(1)),
      median: Number(rates[Math.floor(rates.length / 2)].toFixed(1)),
    },
    workerCpuCores: Number(((after.worker - before.worker) / elapsed).toFixed(2)),
    webCpuCores: after.web.map((value, i) =>
      Number(((value - before.web[i]) / elapsed).toFixed(2)),
    ),
    databaseTransactionsPerSecond: Math.round(
      (after.transactions - before.transactions) / elapsed,
    ),
  }
  console.log(JSON.stringify(result, null, 2))
  assert.ok(result.connectedAudio >= receivers, 'every listener keeps audio')
  assert.ok(result.authenticatedSockets >= total, 'every socket stays authenticated')
  assert.equal(result.socketClosures, 0, 'no player socket closed during the run')
  assert.equal(result.peerFailures, 0, 'no media peer failed during the run')
  assert.equal(result.steadyRenegotiations, 0, 'no media renegotiation while steady')
  assert.ok(
    result.packetsPerListener.p01 >= (1000 / packetMs) * 0.9,
    'every listener receives continuous audio',
  )
  console.log(`PASS capacity: ${total} listeners in ${roomCount} rooms`)
} finally {
  await Promise.allSettled(
    children.map(async (child) => {
      if (child.connected) {
        await Promise.race([request(child, 'stop'), delay(15_000)])
      }
      child.kill()
    }),
  )
  await Promise.allSettled(servers.map((server) => server.close()))
  await worker?.close()
  index?.close()
  if (rooms.length) {
    const ids = rooms.map((room) => room.id)
    await pool.query(
      'delete from media_connection where session_id in (select id from listener_session where room_id = any($1))',
      [ids],
    )
    await pool.query(
      'delete from player_connection where session_id in (select id from listener_session where room_id = any($1))',
      [ids],
    )
    await pool.query(
      `update nickname set current_session_id = null
       where current_session_id in (select id from listener_session where room_id = any($1))`,
      [ids],
    )
    await pool.query('delete from listener_session where room_id = any($1)', [ids])
    await pool.query('delete from voice_source_run where room_id = any($1)', [ids])
    await pool.query('delete from room where id = any($1)', [ids])
  }
  await pool.end()
}
