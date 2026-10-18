import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { WebSocket } from 'ws'
import { RTCPeerConnection } from 'werift'
import { createLiveSubtitleFixture } from '../../../scripts/fixtures/live-subtitles.mjs'
import {
  until,
  candidateSockets,
  portsReleased,
} from '../../../scripts/fixtures/media-worker.mjs'

const tokens = (text) => [
  { text, is_final: true, language: 'en' },
  { text: '<end>', is_final: true },
]
const has = (client, text, language) =>
  client
    .values()
    .some(
      (value) =>
        value.originalText === text &&
        value.translatedText === `fixture:${language}:${text}`,
    )

test(
  'configured shared subtitles reach only current real player subscriptions, independently of original audio',
  { timeout: 60_000 },
  async (t) => {
    const f = await createLiveSubtitleFixture()
    t.after(() => f.close())
    await f.language('ja')
    await f.language('ko')
    const a = await f.enter('subtitle-a', 'ja'),
      b = await f.enter('subtitle-b', 'ja'),
      c = await f.enter('subtitle-c', 'ko')
    await until(
      () => [a, b, c].every((client) => client.subtitles().length),
      'private streaming subscription established',
    )
    assert.equal(
      (await fetch(`${f.controlOrigin}/subtitles`, { method: 'POST' })).status,
      401,
    )
    const spoofed = await fetch(`${f.controlOrigin}/subtitles`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${f.secret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        connectionId: randomUUID(),
        reference: {
          sessionId: a.session.sessionId,
          nicknameGeneration: a.session.nicknameGeneration,
        },
        subscriptionVersion: 0,
      }),
    })
    assert.equal(
      spoofed.status,
      404,
      'A private control credential is insufficient without the registered player connection',
    )

    const offer = await f.json(
      await a.request(`/api/player/sessions/${a.session.sessionId}/media`, 'POST', {
        operation: 'offer',
        connectionId: randomUUID(),
        attempt: 1,
      }),
    )
    const receiver = new RTCPeerConnection({ iceServers: [], iceUseIpv6: false })
    t.after(() => receiver.close())
    let audioPackets = 0
    receiver.onTrack.subscribe((track) =>
      track.onReceiveRtp.subscribe(() => {
        audioPackets++
      }),
    )
    await receiver.setRemoteDescription(offer.description)
    await receiver.setLocalDescription(await receiver.createAnswer())
    await f.json(
      await a.request(`/api/player/sessions/${a.session.sessionId}/media`, 'POST', {
        operation: 'answer',
        connectionId: offer.connectionId,
        description: { type: 'answer', sdp: receiver.localDescription.sdp },
      }),
    )
    await until(
      () => receiver.connectionState === 'connected',
      'real original-audio peer',
    )
    f.speak('synthetic-one', '同名测试成员')
    const activeRecognition = () =>
      f.network.observations.filter(
        (value) =>
          value.protocol === 'soniox' &&
          value.key === f.recognitionKey &&
          !value.closed,
      )
    await until(
      () =>
        activeRecognition().length === 1 &&
        activeRecognition()[0].frames.some((frame) => !frame.silence),
      'independent mono PCM reaches recognition',
    )
    const recognition = activeRecognition()[0]
    assert.equal(recognition.configuration.num_channels, 1)
    assert.equal(recognition.configuration.sample_rate, 48_000)
    const firstMark = f.network.observations.length
    f.network.transcript(f.recognitionKey, tokens('Wait here.'), recognition)
    await until(
      () =>
        has(a, 'Wait here.', 'JA') &&
        has(b, 'Wait here.', 'JA') &&
        has(c, 'Wait here.', 'KO'),
      'same source delivered through actual private HTTP and player WebSockets',
    )
    assert.equal(
      f.network.observations
        .slice(firstMark)
        .filter((value) => value.protocol === 'deepl').length,
      2,
      'Translation scales with language, not player count',
    )
    const received = a.values().find((value) => value.translatedText)
    assert.equal(received.speakerId, 'synthetic-one')
    assert.equal(received.originalText, 'Wait here.')
    assert.equal(
      received.audioStartMs,
      null,
      'Missing provider timestamps are not invented',
    )
    assert.equal(received.sourceIsFinal, true)
    assert.equal(received.translationIsFinal, true)

    const held = f.network.hold(f.translationKey)
    f.network.transcript(f.recognitionKey, tokens('Turn left.'), recognition)
    await held.started
    const audioBefore = audioPackets
    const changed = await f.json(
      await a.request(`/api/player/sessions/${a.session.sessionId}/language`, 'PATCH', {
        outputLanguage: 'ko',
      }),
    )
    assert.equal(changed.sessionId, a.session.sessionId)
    assert.equal(changed.nicknameGeneration, a.session.nicknameGeneration)
    assert.equal(changed.subscriptionVersion, 1)
    const late = await f.enter('subtitle-late', 'ja')
    await until(
      () =>
        a.events.some(
          (event) =>
            event.type === 'session' && event.session.subscriptionVersion === 1,
        ) && late.subtitles().length,
      'changed and new subscriptions attach after old speech',
    )
    await until(
      () => audioPackets > audioBefore + 10,
      'slow translation does not stop original-audio packets',
    )
    assert.equal(receiver.connectionState, 'connected')
    held.release()
    await until(
      () => has(b, 'Turn left.', 'JA') && has(c, 'Turn left.', 'KO'),
      'old eligible subscribers finish held translation',
    )
    f.network.transcript(f.recognitionKey, tokens('Retreat now.'), recognition)
    await until(
      () => has(a, 'Retreat now.', 'KO') && has(late, 'Retreat now.', 'JA'),
      'new subscriptions receive only subsequent speech',
    )
    assert.equal(has(a, 'Turn left.', 'KO'), false)
    assert.equal(has(late, 'Turn left.', 'JA'), false)
    assert.equal(has(late, 'Wait here.', 'JA'), false)
    assert.equal(
      activeRecognition().length,
      1,
      'Changing language does not restart shared recognition',
    )

    const obsolete = f.network.hold(f.translationKey)
    f.network.transcript(f.recognitionKey, tokens('Obsolete position.'), recognition)
    await obsolete.started
    await f.replaceSource()
    await until(
      () =>
        recognition.closed &&
        activeRecognition().length === 1 &&
        activeRecognition()[0].frames.length > 2,
      'old recognition closes and a fresh source consumes only current PCM',
    )
    const fresh = activeRecognition()[0]
    obsolete.release()
    f.network.transcript(f.recognitionKey, tokens('Wait 3 seconds.'), fresh)
    await until(
      () => has(a, 'Wait 3 seconds.', 'KO') && has(b, 'Wait 3 seconds.', 'JA'),
      'new source reaches current listeners',
    )
    assert.ok(
      a
        .values()
        .filter((value) => value.originalText === 'Wait 3 seconds.')
        .every((value) => value.sourceGeneration === 4),
    )
    assert.equal(
      [a, b, c, late].some((client) =>
        client
          .values()
          .some(
            (value) =>
              value.originalText === 'Obsolete position.' && value.translatedText,
          ),
      ),
      false,
    )

    f.speak('synthetic-two', '同名测试成员')
    await until(
      () =>
        activeRecognition().length === 2 &&
        activeRecognition().every((value) => value.frames.length > 2),
      'two members use independent recognition sockets',
    )
    const second = activeRecognition().find((value) => value !== fresh)
    f.network.transcript(f.recognitionKey, tokens('Team one wait.'), fresh)
    f.network.transcript(f.recognitionKey, tokens('Team two retreat.'), second)
    await until(
      () => has(b, 'Team one wait.', 'JA') && has(b, 'Team two retreat.', 'JA'),
      'same display name retains independent member identity',
    )
    assert.equal(
      b.values().find((value) => value.originalText === 'Team one wait.').speakerId,
      'synthetic-one',
    )
    assert.equal(
      b.values().find((value) => value.originalText === 'Team two retreat.').speakerId,
      'synthetic-two',
    )
    f.network.setMode(f.translationKey, 'quota')
    f.network.transcript(f.recognitionKey, tokens('Do not attack.'), fresh)
    await until(
      () => a.values().some((value) => value.failure === 'QUOTA_EXHAUSTED'),
      'selected-language failure is visible without fallback',
    )
    assert.equal(
      (
        await f.json(
          await a.request(`/api/player/sessions/${a.session.sessionId}`, 'GET'),
        )
      ).outputLanguage,
      'ko',
    )
    assert.equal(receiver.connectionState, 'connected')
    const failedAudio = audioPackets
    await until(
      () => audioPackets > failedAudio + 5,
      'audio continues after provider failure',
    )
    f.network.setMode(f.translationKey, 'echo')

    const outdated = f.network.hold(f.translationKey)
    f.network.transcript(f.recognitionKey, tokens('Old configuration.'), fresh)
    await outdated.started
    const beforeChange = b.subtitles().length
    const newKey = f.network.credential('echo')
    await f.database.pool.query(
      "update provider_configuration set last_test_started_at=now()-interval '1 minute' where id=$1",
      [f.translationId],
    )
    await f.json(
      await f.management(`/providers/${f.translationId}`, 'PUT', {
        expectedVersion: 1,
        name: 'Replaced synthetic translation fixture',
        credential: newKey,
        settings: {
          type: 'deepl',
          endpoint: 'https://api-free.deepl.com',
          model: 'prefer_quality_optimized',
          timeoutMs: 15_000,
        },
      }),
    )
    await until(
      () =>
        b
          .subtitles()
          .slice(beforeChange)
          .some(
            (event) =>
              event.event.type === 'subtitle-state' &&
              event.event.speakerId === 'synthetic-one' &&
              event.event.state === 'WAITING',
          ),
      'saved provider change resets the affected live subtitle lane',
    )
    outdated.release()
    f.network.transcript(f.recognitionKey, tokens('New configuration.'), fresh)
    await until(
      () => has(b, 'New configuration.', 'JA') && has(c, 'New configuration.', 'KO'),
      'new protected credential takes effect without deployment',
    )
    assert.equal(
      activeRecognition().includes(fresh),
      true,
      'Translation replacement retains recognition',
    )
    assert.equal(activeRecognition().includes(second), true)
    assert.ok(
      f.network.observations.some(
        (value) =>
          value.protocol === 'deepl' &&
          value.key === newKey &&
          value.body.text.includes('New configuration.'),
      ),
    )
    assert.equal(
      [a, b, c, late].some((client) =>
        client
          .values()
          .some(
            (value) =>
              value.originalText === 'Old configuration.' && value.translatedText,
          ),
      ),
      false,
    )

    const oldCount = a.values().length
    const replacement = await f.enter('subtitle-a', 'ko')
    assert.ok(replacement.session.nicknameGeneration > a.session.nicknameGeneration)
    assert.equal(a.socket.readyState, WebSocket.CLOSED)
    assert.ok(
      await portsReleased(candidateSockets(offer)),
      'Replacement waited for actual old media closure',
    )
    f.network.transcript(f.recognitionKey, tokens('Current listener only.'), fresh)
    await until(
      () => has(replacement, 'Current listener only.', 'KO'),
      'replacement receives fresh speech',
    )
    assert.equal(a.values().length, oldCount)
    const oldSocket = new WebSocket(
      `${f.web.origin.replace('http:', 'ws:')}/api/player/ws`,
      { origin: f.web.origin },
    )
    t.after(() => oldSocket.terminate())
    const oldEvents = []
    oldSocket.on('message', (data) => oldEvents.push(JSON.parse(data.toString())))
    await new Promise((resolve) => oldSocket.once('open', resolve))
    oldSocket.send(
      JSON.stringify({
        type: 'authenticate',
        sessionId: a.session.sessionId,
        credential: a.credential,
      }),
    )
    await until(
      () => oldSocket.readyState === WebSocket.CLOSED,
      'old credential cannot restore subtitle delivery',
    )
    assert.equal(
      oldEvents.some((event) => event.type === 'subtitles'),
      false,
    )
    const disabledWork = f.network.hold(newKey)
    f.network.transcript(f.recognitionKey, tokens('Disabled source.'), fresh)
    await disabledWork.started
    const languages = await f.json(await f.management('/languages'))
    for (const language of languages.items) {
      await f.json(
        await f.management(`/languages/${language.code}/state`, 'POST', {
          expectedVersion: language.version,
          enabled: false,
        }),
      )
    }
    await until(
      () => activeRecognition().length === 0,
      'disabling all languages physically releases recognition sockets',
    )
    const config = await f.json(await fetch(`${f.web.origin}/api/player/config`))
    assert.deepEqual(config.outputLanguages, [])
    const finalCount = replacement.values().length
    disabledWork.release()
    await until(
      () =>
        replacement.events.some(
          (event) =>
            event.type === 'configuration' &&
            event.configuration.outputLanguages.length === 0,
        ),
      'players receive the disabled catalog',
    )
    assert.equal(replacement.values().length, finalCount)
  },
)
