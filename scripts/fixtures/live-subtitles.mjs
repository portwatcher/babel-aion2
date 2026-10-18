import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import pg from 'pg'
import { WebSocket } from 'ws'
import { createDatabase } from '@babel/database'
import { createCredentialCipher } from '@babel/database/credentials'
import { createManagementFixture } from '../management-fixture.mjs'
import { createProviderFixture } from './provider-server.mjs'
import { routeProviderNetwork } from './provider-network.mjs'
import { syntheticWave } from './audio-sample.mjs'
import { until } from './media-worker.mjs'
import { MediaPeers } from '../../apps/voice-worker/src/media-peers.ts'
import { createMediaNetwork } from '../../apps/voice-worker/src/media-network.ts'
import { RoomAudio } from '../../apps/voice-worker/src/room-audio.ts'
import { SubtitleService } from '../../apps/voice-worker/src/subtitle-service.ts'
import { createControlServer } from '../../apps/voice-worker/src/control-server.ts'

const exec = promisify(execFile)
export async function createLiveSubtitleFixture(mediaEnvironment = {}) {
  const url = new URL(process.env.DATABASE_URL)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  const admin = new pg.Client({ connectionString: url.toString() })
  await admin.connect()
  const name = `babel_subtitles_${randomUUID().replaceAll('-', '')}`
  await admin.query(`create database ${name}`)
  url.pathname = `/${name}`
  let database, network, restore, service, peers, control, web, source, audio
  const sockets = []
  const feeds = []
  const roomId = '00000000-0000-4000-8000-000000000001'
  async function close() {
    for (const feed of feeds) clearInterval(feed)
    for (const socket of sockets) socket.terminate()
    source?.close()
    audio?.close()
    await web?.close()
    await service?.stop()
    await peers?.stop()
    if (control) {
      control.closeAllConnections()
      await new Promise((resolve) => control.close(resolve))
    }
    await database?.close()
    restore?.()
    await network?.close()
    // pg-pool can resolve end() before its clients finish closing their sockets.
    // Observe server-side disconnection before dropping this fixture's database;
    // FORCE can otherwise inject 57P01 into a client that is still shutting down.
    await until(
      async () => {
        const { rows } = await admin.query(
          'select count(*)::int as count from pg_stat_activity where datname=$1',
          [name],
        )
        return rows[0].count === 0
      },
      'fixture PostgreSQL connections physically drained',
      3_000,
    )
    await admin.query(`drop database ${name}`)
    await admin.end()
  }
  try {
    await exec(process.execPath, ['packages/database/dist/migrate.mjs'], {
      env: { ...process.env, DATABASE_URL: url.toString() },
      maxBuffer: 1_000_000,
    }).catch(() => {
      throw new Error('Disposable subtitle database migration failed')
    })
    database = createDatabase(url.toString(), { queryTimeoutMs: 2_000 })
    const identity = await createManagementFixture(url.toString())
    network = await createProviderFixture()
    restore = routeProviderNetwork(network.origin)
    service = new SubtitleService(
      database.db,
      createCredentialCipher(identity.key.toString('base64')),
    )
    peers = new MediaPeers(database.db, createMediaNetwork(mediaEnvironment))
    const secret = randomBytes(32).toString('base64url')
    // Decoded synthetic PCM enters the same production source port as Discord.
    // This fixture does not exercise or claim a Discord join/ownership receipt.
    control = createControlServer(
      peers,
      secret,
      {
        status() {
          throw new Error('Discord is outside this fixture')
        },
      },
      service,
    )
    control.listen(0, '127.0.0.1')
    await once(control, 'listening')
    const controlOrigin = `http://127.0.0.1:${control.address().port}`
    web = await identity.start(
      {
        NUXT_MEDIA_CONTROL_URL: controlOrigin,
        NUXT_MEDIA_CONTROL_SECRET: secret,
        BABEL_TEST_PROVIDER_ORIGIN: network.origin,
      },
      ['./scripts/fixtures/provider-network.mjs'],
    )
    const auth = await identity.signIn(web)
    async function management(path, method = 'GET', body) {
      return fetch(`${web.origin}/api/management${path}`, {
        method,
        headers: {
          origin: web.origin,
          cookie: auth.cookie,
          'cf-access-jwt-assertion': auth.jwt,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      })
    }
    async function json(response, status = 200) {
      assert.equal(response.status, status)
      return response.json()
    }
    await fetch(`${web.origin}/api/player/config`)
    await database.pool.query(
      'update room set stopped=false, source_generation=3 where id=$1',
      [roomId],
    )
    source = service.source(roomId, 3, () => true)
    audio = new RoomAudio(
      () => true,
      (packet) => peers.publish(roomId, packet),
      () => assert.fail('Native playback failed'),
    )
    const recognitionId = randomUUID(),
      translationId = randomUUID()
    const recognitionKey = network.credential('speech'),
      translationKey = network.credential('echo')
    await json(
      await management(`/providers/${recognitionId}`, 'PUT', {
        expectedVersion: 0,
        name: 'Synthetic recognition fixture',
        credential: recognitionKey,
        settings: { type: 'soniox', model: 'stt-rt-v5', timeoutMs: 3_000 },
      }),
    )
    await json(
      await management(`/providers/${translationId}`, 'PUT', {
        expectedVersion: 0,
        name: 'Synthetic translation fixture',
        credential: translationKey,
        settings: {
          type: 'deepl',
          endpoint: 'https://api-free.deepl.com',
          model: 'prefer_quality_optimized',
          timeoutMs: 15_000,
        },
      }),
    )
    async function language(code) {
      const saved = await json(
        await management(`/languages/${code}`, 'PUT', {
          expectedVersion: 0,
          name: `Fixture ${code}`,
          recognitionConfigurationId: recognitionId,
          translationConfigurationId: translationId,
          includeTerms: false,
        }),
      )
      await database.pool.query(
        "update provider_configuration set last_test_started_at=now()-interval '1 minute'",
      )
      network.setMode(recognitionKey, 'speech')
      const validated = await json(
        await management(`/languages/${code}/validate`, 'POST', {
          expectedVersion: saved.version,
          audioBase64: syntheticWave().toString('base64'),
        }),
      )
      assert.equal(validated.language.validationState, 'CURRENT')
      network.setMode(recognitionKey, 'pass')
      return json(
        await management(`/languages/${code}/state`, 'POST', {
          expectedVersion: validated.language.version,
          enabled: true,
        }),
      )
    }
    async function enter(nickname, outputLanguage = null) {
      const credential = randomBytes(32).toString('base64url')
      async function request(path, method, body) {
        return fetch(`${web.origin}${path}`, {
          method,
          headers: {
            origin: web.origin,
            authorization: `Bearer ${credential}`,
            'content-type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        })
      }
      const entry = await request('/api/player/sessions', 'POST', {
        nickname,
        outputLanguage,
        requestId: randomUUID(),
      })
      assert.ok([200, 202].includes(entry.status))
      let session = await entry.json()
      if (session.state === 'JOINING') {
        await until(async () => {
          session = await json(
            await request(`/api/player/sessions/${session.sessionId}`, 'GET'),
          )
          return session.state === 'ACTIVE'
        }, 'actual old delivery closes before replacement activation')
      }
      assert.equal(session.state, 'ACTIVE')
      const socket = new WebSocket(
        `${web.origin.replace('http:', 'ws:')}/api/player/ws`,
        { origin: web.origin },
      )
      sockets.push(socket)
      const events = []
      socket.on('message', (data) => {
        const event = JSON.parse(data.toString())
        if (event.type === 'ping')
          socket.send(JSON.stringify({ type: 'pong', nonce: event.nonce }))
        else events.push(event)
      })
      await once(socket, 'open')
      socket.send(
        JSON.stringify({
          type: 'authenticate',
          sessionId: session.sessionId,
          credential,
        }),
      )
      await until(
        () => events.some((event) => event.type === 'session'),
        'authenticated real player socket',
      )
      return {
        session,
        socket,
        events,
        credential,
        request,
        subtitles: () => events.filter((event) => event.type === 'subtitles'),
        values: () =>
          events
            .filter(
              (event) => event.type === 'subtitles' && event.event.type === 'subtitle',
            )
            .map((event) => event.event.value),
      }
    }
    function speak(id, displayName = 'Synthetic member') {
      const frame = Buffer.alloc(3840)
      for (let sample = 0; sample < 960; sample++) {
        const value = Math.round(10_000 * Math.sin((sample * Math.PI) / 24))
        frame.writeInt16LE(value, sample * 4)
        frame.writeInt16LE(value, sample * 4 + 2)
      }
      const feed = setInterval(() => {
        audio.receive(id, frame)
        source.receive(id, displayName, frame)
      }, 20)
      feeds.push(feed)
      return () => clearInterval(feed)
    }
    return {
      database,
      identity,
      auth,
      web,
      service,
      source,
      peers,
      controlOrigin,
      secret,
      network,
      recognitionKey,
      translationKey,
      recognitionId,
      translationId,
      roomId,
      language,
      enter,
      speak,
      management,
      json,
      close,
      async replaceSource() {
        source.close()
        await database.pool.query(
          'update room set source_generation=source_generation+1 where id=$1',
          [roomId],
        )
        const { rows } = await database.pool.query(
          'select source_generation from room where id=$1',
          [roomId],
        )
        source = service.source(roomId, Number(rows[0].source_generation), () => true)
      },
    }
  } catch (error) {
    await close()
    throw error
  }
}
