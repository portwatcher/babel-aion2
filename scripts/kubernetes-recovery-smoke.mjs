import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket from 'ws'
import pg from 'pg'
import {
  command,
  finalizer,
  kubernetesFixture,
} from './fixtures/kubernetes-cluster.mjs'

const [context, webImage, voiceImage] = process.argv.slice(2)
const fixture = await kubernetesFixture(context, webImage, voiceImage)
const database = new pg.Client({ connectionString: fixture.databaseUrl })
const sockets = []
const report = {
  scope: 'isolated real Kubernetes, generated data, no Discord or provider credentials',
  checks: {},
}
async function until(predicate, label, timeout = 90_000) {
  const end = performance.now() + timeout
  while (performance.now() < end) {
    if (await predicate()) {
      return
    }
    await delay(300)
  }
  throw new Error(label)
}
async function api(entry, path, method = 'GET', body) {
  return fetch(fixture.origin + path, {
    method,
    headers: {
      origin: fixture.origin,
      authorization: `Bearer ${entry.credential}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
}
async function enter(nickname = `pod-${randomUUID().slice(0, 10)}`) {
  const entry = { nickname, credential: randomBytes(32).toString('base64url') }
  const response = await api(entry, '/api/player/sessions', 'POST', {
    nickname,
    outputLanguage: null,
    requestId: randomUUID(),
  })
  assert.ok([200, 202].includes(response.status))
  entry.session = await response.json()
  return entry
}
async function state(entry) {
  return (await api(entry, `/api/player/sessions/${entry.session.sessionId}`)).json()
}
async function connect(entry, port) {
  await until(
    async () => {
      try {
        return (
          await fetch(`http://127.0.0.1:${port}/api/health/ready`, {
            signal: AbortSignal.timeout(1_000),
          })
        ).ok
      } catch {
        return false
      }
    },
    'The actual player network route is not ready',
    15_000,
  )
  const socket = new WebSocket(`ws://127.0.0.1:${port}/api/player/ws`, {
    headers: { origin: fixture.origin },
  })
  sockets.push(socket)
  const events = [],
    closed = new Promise((resolve) => socket.once('close', (...args) => resolve(args)))
  socket.on('error', () => {})
  socket.on('message', (data) => {
    const event = JSON.parse(data.toString())
    events.push(event)
    if (event.type === 'ping') {
      socket.send(JSON.stringify({ type: 'pong', nonce: event.nonce }))
    }
  })
  await once(socket, 'open')
  socket.send(
    JSON.stringify({
      type: 'authenticate',
      sessionId: entry.session.sessionId,
      credential: entry.credential,
    }),
  )
  await until(
    () => events.some((event) => event.type === 'session'),
    'Actual player socket did not authenticate',
    10_000,
  )
  return { socket, closed }
}
async function registration(entry) {
  return (
    await database.query(
      'select p.id,p.owner_id,o.pod_uid from player_connection p join runtime_owner o on o.id=p.owner_id where p.session_id=$1 and p.closed_at is null',
      [entry.session.sessionId],
    )
  ).rows[0]
}
async function receipts(id) {
  return (
    await database.query(
      'select p.closed_at,o.exited_at,r.retired_at,r.exit_evidence from player_connection p join runtime_owner o on o.id=p.owner_id join runtime_pod r on r.uid=o.pod_uid where p.id=$1',
      [id],
    )
  ).rows[0]
}
function killContainer(pod, name) {
  assert.equal(pod.metadata.namespace, fixture.namespace)
  assert.equal(pod.metadata.labels['babel-recovery-test'], fixture.runId)
  assert.equal(pod.spec.nodeName, `${context}-m02`)
  const status = pod.status.containerStatuses.find((item) => item.name === name)
  const id = status.containerID.replace(/^containerd:\/\//, '')
  assert.match(id, /^[a-f0-9]{64}$/)
  const actual = JSON.parse(
    command('docker', [
      'exec',
      pod.spec.nodeName,
      'ctr',
      '-n',
      'k8s.io',
      'containers',
      'info',
      id,
    ]),
  )
  assert.equal(actual.Labels['io.kubernetes.pod.uid'], pod.metadata.uid)
  assert.equal(actual.Labels['io.kubernetes.pod.namespace'], fixture.namespace)
  command('docker', [
    'exec',
    pod.spec.nodeName,
    'ctr',
    '-n',
    'k8s.io',
    'tasks',
    'kill',
    '--all',
    '--signal',
    'SIGKILL',
    id,
  ])
}
try {
  await database.connect()
  const pod = fixture.pod('web')
  const entry = await enter(),
    sibling = await enter()
  const live = await connect(entry, fixture.ports.web)
  const survivor = await connect(sibling, fixture.ports.stable)
  const old = await registration(entry),
    other = await registration(sibling)
  assert.equal(old.pod_uid, pod.metadata.uid)
  assert.notEqual(other.pod_uid, old.pod_uid)

  fixture.kube(['scale', 'deployment/recovery', '--replicas=0'])
  fixture.kube(['wait', '--for=delete', 'pod', '-l', 'app=recovery', '--timeout=30s'])
  killContainer(pod, 'web')
  assert.equal((await live.closed)[0], 1006, 'The real socket must physically stop')
  await until(
    async () =>
      (
        await database.query(
          'select retirement_requested_at from runtime_pod where uid=$1',
          [old.pod_uid],
        )
      ).rows[0]?.retirement_requested_at,
    'Restarted supervisor did not request Pod retirement',
  )
  assert.equal(
    (
      await database.query(
        'select count(*)::int as count from runtime_owner where pod_uid=$1',
        [old.pod_uid],
      )
    ).rows[0].count,
    1,
    'An unknown owner was replaced without physical proof',
  )
  assert.equal((await receipts(old.id)).exited_at, null)
  const restored = await state(entry)
  assert.equal(restored.sessionId, entry.session.sessionId)
  assert.equal(restored.nicknameGeneration, entry.session.nicknameGeneration)
  const replacement = await enter(entry.nickname)
  assert.equal((await state(replacement)).state, 'JOINING')
  assert.equal(
    (await enter()).session.state,
    'ACTIVE',
    'Independent admission must still work',
  )
  report.checks.controllerUnavailable =
    'PASS: old receipt remains unknown; same-nickname entry waits; unrelated entry works'

  fixture.kube(['scale', 'deployment/recovery', '--replicas=1'])
  fixture.rollout('recovery')
  await until(
    async () => (await receipts(old.id)).retired_at,
    'Controller did not persist Pod exit',
  )
  const confirmed = await receipts(old.id)
  assert.ok(confirmed.closed_at && confirmed.exited_at)
  assert.equal(confirmed.exit_evidence.kind, 'kubelet-terminated')
  assert.ok(
    confirmed.exit_evidence.containers.every(
      (item) => item.containerId && item.finishedAt,
    ),
  )
  await until(
    async () => (await state(replacement)).state === 'ACTIVE',
    'Same-nickname replacement remained blocked',
  )
  assert.equal(survivor.socket.readyState, WebSocket.OPEN)
  assert.equal((await receipts(other.id)).closed_at, null)
  fixture.rollout('web')
  assert.notEqual(fixture.pod('web').metadata.uid, pod.metadata.uid)
  report.checks.containerCrash =
    'PASS: real container SIGKILL, durable kubelet receipt, replacement ACTIVE, other Pod unaffected'

  // A real, still-running Pod plus an explicitly simulated API unknown status.
  // This negative control must not be mistaken for physical-exit evidence.
  const current = fixture.pod('web')
  const uncertain = await enter()
  const ongoing = await connect(uncertain, fixture.ports.web)
  const unknown = await registration(uncertain)
  assert.equal(unknown.pod_uid, current.metadata.uid)
  command('docker', ['exec', `${context}-m02`, 'systemctl', 'stop', 'kubelet'])
  fixture.kube(['delete', 'pod', current.metadata.name, '--wait=false'])
  const previous = current.status.containerStatuses[0]
  const synthetic = {
    ...previous,
    ready: false,
    state: {
      terminated: {
        exitCode: 137,
        reason: 'ContainerStatusUnknown',
        message: 'Explicit isolated-test simulation',
      },
    },
  }
  fixture.kube([
    'patch',
    'pod',
    current.metadata.name,
    '--subresource=status',
    '--type=merge',
    '-p',
    JSON.stringify({ status: { phase: 'Failed', containerStatuses: [synthetic] } }),
  ])
  await delay(6_000)
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('The negative-control socket is not physically live')),
      5_000,
    )
    ongoing.socket.once('pong', () => {
      clearTimeout(timer)
      resolve()
    })
    ongoing.socket.ping('still-alive')
  })
  assert.equal(
    ongoing.socket.readyState,
    WebSocket.OPEN,
    'The unknown-status control must still own a real socket',
  )
  assert.equal((await receipts(unknown.id)).closed_at, null)
  assert.equal((await receipts(unknown.id)).exited_at, null)
  const retained = JSON.parse(
    fixture.kube(['get', 'pod', current.metadata.name, '-o', 'json']),
  )
  assert.equal(retained.metadata.uid, current.metadata.uid)
  report.unknownTermination = retained.status.containerStatuses[0].state.terminated
  const pending = {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      name: 'pending-proof',
      namespace: fixture.namespace,
      labels: {
        'babel-recovery-test': fixture.runId,
        'babel.juryquinn.com/supervised': 'true',
      },
      finalizers: [finalizer],
    },
    spec: {
      nodeName: `${context}-m02`,
      automountServiceAccountToken: false,
      containers: [
        { name: 'never-started', image: webImage, imagePullPolicy: 'Never' },
      ],
    },
  }
  const created = JSON.parse(
    fixture.kube(['create', '-f', '-', '-o', 'json'], JSON.stringify(pending)),
  )
  fixture.kube(['delete', 'pod', pending.metadata.name, '--wait=false'])
  await until(
    () => {
      const raw = fixture
        .kube(['get', 'pod', pending.metadata.name, '--ignore-not-found', '-o', 'json'])
        .trim()
      return !raw || !JSON.parse(raw).metadata.finalizers?.includes(finalizer)
    },
    'Unknown container status blocked recovery of another Pod',
    15_000,
  )
  const pendingBarrier = (
    await database.query(
      'select retired_at,exit_evidence from runtime_pod where uid=$1',
      [created.metadata.uid],
    )
  ).rows[0]
  assert.ok(pendingBarrier.retired_at)
  assert.equal(pendingBarrier.exit_evidence.kind, 'owners-exited')
  report.checks.unknownStatus =
    'PASS: unknown status retained the live socket and owner; another never-started Pod sealed admission and released its finalizer'
  command('docker', ['exec', `${context}-m02`, 'systemctl', 'start', 'kubelet'])
  await until(
    async () => (await receipts(unknown.id)).retired_at,
    'Recovery did not resume after kubelet returned',
  )
  await ongoing.closed
  fixture.rollout('web')

  // The normal media API allocates a real worker peer. No fabricated DB rows.
  const mediaEntry = await enter()
  const connectionId = randomUUID()
  const offer = await api(
    mediaEntry,
    `/api/player/sessions/${mediaEntry.session.sessionId}/media`,
    'POST',
    { operation: 'offer', connectionId, attempt: 1 },
  )
  assert.equal(offer.status, 200)
  const description = await offer.json()
  assert.match(description.description.sdp, /a=candidate:/)
  const voice = fixture.pod('voice')
  const media = (
    await database.query(
      'select m.id,m.owner_id,o.pod_uid from media_connection m join runtime_owner o on o.id=m.owner_id where m.id=$1',
      [connectionId],
    )
  ).rows[0]
  assert.equal(media.pod_uid, voice.metadata.uid)
  killContainer(voice, 'voice')
  await until(
    async () =>
      (
        await database.query(
          'select m.closed_at,o.exited_at,p.exit_evidence from media_connection m join runtime_owner o on o.id=m.owner_id join runtime_pod p on p.uid=o.pod_uid where m.id=$1',
          [connectionId],
        )
      ).rows[0]?.closed_at,
    'Worker whole-container loss did not retire its media registration',
  )
  fixture.rollout('voice')
  const retryConnection = randomUUID()
  await until(
    async () => {
      const retry = await api(
        mediaEntry,
        `/api/player/sessions/${mediaEntry.session.sessionId}/media`,
        'POST',
        { operation: 'offer', connectionId: retryConnection, attempt: 2 },
      )
      if (retry.status === 503) {
        return false
      }
      assert.equal(retry.status, 200)
      return true
    },
    'Current listener could not negotiate after worker replacement',
    15_000,
  )
  const retiredMedia = (
    await database.query(
      'select o.exited_at,p.exit_evidence from runtime_owner o join runtime_pod p on p.uid=o.pod_uid where o.id=$1',
      [media.owner_id],
    )
  ).rows[0]
  assert.ok(retiredMedia.exited_at)
  assert.equal(retiredMedia.exit_evidence.kind, 'kubelet-terminated')
  const mediaRestored = await state(mediaEntry)
  assert.equal(mediaRestored.sessionId, mediaEntry.session.sessionId)
  assert.equal(mediaRestored.nicknameGeneration, mediaEntry.session.nicknameGeneration)
  assert.equal((await receipts(other.id)).closed_at, null)
  report.checks.workerCrash =
    'PASS: real media peer allocation, container SIGKILL, scoped closure and new offer; no claim of live speech'
  report.result = 'PASS'
} catch (error) {
  report.result = 'FAIL'
  report.failure = error.message
  process.exitCode = 1
} finally {
  for (const socket of sockets) {
    socket.terminate()
  }
  await database.end()
  await fixture.close()
  report.cleanup = 'PASS'
  console.log(JSON.stringify(report, null, 2))
}
