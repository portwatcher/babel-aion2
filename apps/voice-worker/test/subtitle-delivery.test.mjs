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

const has = (client, text) =>
  client.values().some((value) => value.translatedText.includes(text))

test(
  'shared recognition and streaming text translations reach current player sockets while original audio and other languages remain independent',
  { timeout: 60_000 },
  async (t) => {
    const f = await createLiveSubtitleFixture()
    t.after(() => f.close())
    const koreanTranslationId = randomUUID()
    const koreanTranslationKey = f.network.credential('echo')
    await f.json(
      await f.management(`/providers/${koreanTranslationId}`, 'PUT', {
        expectedVersion: 0,
        name: 'Synthetic Korean translation fixture',
        credential: koreanTranslationKey,
        settings: { type: 'openai', timeoutMs: 15_000 },
      }),
    )
    await f.language('ja')
    await f.language('ko', koreanTranslationId)
    const a = await f.enter('subtitle-a', 'ja'),
      b = await f.enter('subtitle-b', 'ja'),
      c = await f.enter('subtitle-c', 'ko')
    await until(
      () => [a, b, c].every((client) => client.subtitles().length),
      'private subscriptions established',
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
      'control secret alone cannot impersonate a player',
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
    let packets = 0
    receiver.onTrack.subscribe((track) =>
      track.onReceiveRtp.subscribe(() => {
        packets++
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
      'actual original-audio peer',
    )
    const activeRecognitions = () =>
      f.network.observations.filter(
        (value) =>
          value.protocol === 'recognition' && !value.closed && value.frames.length > 2,
      )
    f.speak('speaker-one', '同名测试成员')
    await until(
      () => activeRecognitions().length === 1,
      'one shared recognition socket for all languages',
    )
    const recognition = activeRecognitions()[0]
    assert.equal(recognition.configuration.audio.input.format.rate, 24000)

    const source = (text, selected = recognition, final = false) =>
      f.network.emit(
        f.recognitionKey,
        {
          type: `conversation.item.input_audio_transcription.${final ? 'completed' : 'delta'}`,
          item_id: randomUUID(),
          [final ? 'transcript' : 'delta']: text,
        },
        selected,
      )

    const beforeTranslations = f.network.observations.filter(
      (value) => value.protocol === 'translation',
    ).length
    source('Wait here.')
    await until(
      () =>
        has(a, 'fixture:ja:Wait here.') &&
        has(b, 'fixture:ja:Wait here.') &&
        has(c, 'fixture:ko:Wait here.'),
      'streaming SSE text crosses private HTTP and public player WebSocket',
    )
    const caption = a
      .values()
      .find((value) => value.translatedText.includes('fixture:ja:Wait here.'))
    assert.equal(caption.speakerId, 'speaker-one')
    assert.equal(caption.sourceAlignment, 'aligned')
    assert.equal(caption.audioStartMs, null)
    assert.equal(
      caption.translationIsFinal,
      false,
      'delta transcript stays provisional until utterance commit',
    )
    assert.equal(
      f.network.observations.filter((value) => value.protocol === 'translation')
        .length - beforeTranslations,
      2,
      'same-language players share one text translation call',
    )

    const late = await f.enter('subtitle-late', 'ja')
    await until(() => late.subtitles().length, 'late subscriber attached')
    const hold = f.network.hold(f.translationKey)
    source('Held Japanese.', recognition, true)
    await hold.started
    const before = packets
    await until(
      () => packets > before + 10,
      'audio continues while translated output is held',
    )
    hold.release()
    await until(
      () => has(late, 'fixture:ja:Held Japanese.'),
      'late player receives subsequent utterances',
    )
    assert.equal(
      has(late, 'fixture:ja:Wait here.'),
      false,
      'never replay a pre-subscription utterance to a late listener',
    )

    const beforeSwitch = a.subtitles().length
    await f.json(
      await a.request(`/api/player/sessions/${a.session.sessionId}/language`, 'PATCH', {
        outputLanguage: 'ko',
      }),
    )
    await until(
      () =>
        a.events.some(
          (event) =>
            event.type === 'session' && event.session.subscriptionVersion === 1,
        ),
      'language switch fenced',
    )
    await until(
      () =>
        a
          .subtitles()
          .slice(beforeSwitch)
          .some((event) => event.outputLanguage === 'ko'),
      'new private language subscription attached',
    )
    source('New Korean.', recognition, true)
    await until(
      () => has(a, 'fixture:ko:New Korean.'),
      'language change receives following utterances',
    )
    assert.equal(
      activeRecognitions()[0],
      recognition,
      'language switching retains shared source connection',
    )

    const obsolete = f.network.hold(f.translationKey)
    source('Obsolete source.', recognition, true)
    await obsolete.started
    await f.replaceSource()
    await until(
      () => recognition.closed && activeRecognitions().length === 1,
      'source generation physically replaces old recognition socket',
    )
    obsolete.release()
    const fresh = activeRecognitions()[0]
    source('Fresh source.', fresh, true)
    await until(
      () => has(a, 'fixture:ko:Fresh source.') && has(b, 'fixture:ja:Fresh source.'),
      'fresh source reaches current listeners',
    )
    assert.ok(
      a
        .values()
        .filter((value) => value.translatedText.includes('fixture:ko:Fresh source.'))
        .every((value) => value.sourceGeneration === 4),
    )
    assert.equal(
      [a, b, c, late].some((client) => has(client, 'Obsolete source.')),
      false,
    )

    f.network.setMode(f.translationKey, 'quota')
    source('Korean still works.', fresh, true)
    await until(
      () =>
        b
          .subtitles()
          .some(
            (event) =>
              event.event.type === 'subtitle-state' &&
              event.event.failure === 'QUOTA_EXHAUSTED',
          ),
      'target failure is visible',
    )
    await until(
      () => has(a, 'fixture:ko:Korean still works.'),
      'failed Japanese target does not block Korean',
    )
    assert.equal(receiver.connectionState, 'connected')

    const oldCount = a.values().length
    const replacement = await f.enter('subtitle-a', 'ko')
    assert.ok(replacement.session.nicknameGeneration > a.session.nicknameGeneration)
    assert.equal(a.socket.readyState, WebSocket.CLOSED)
    assert.ok(
      await portsReleased(candidateSockets(offer)),
      'nickname replacement waits for actual media closure',
    )
    source('Current listener only.', fresh, true)
    await until(
      () => has(replacement, 'fixture:ko:Current listener only.'),
      'replacement receives fresh utterances',
    )
    assert.equal(a.values().length, oldCount)

    for (const client of [b, c, late, replacement]) {
      client.socket.close()
    }
    await until(
      () => activeRecognitions().length === 0,
      'last subtitle listener releases recognition socket while languages remain enabled',
      1500,
    )

    const returning = await f.enter('subtitle-returning', 'ko')
    await until(
      () => activeRecognitions().length === 1,
      'returning listener opens recognition',
    )
    source('Returning listener only.', activeRecognitions()[0], true)
    await until(
      () => has(returning, 'fixture:ko:Returning listener only.'),
      'returning listener receives fresh streaming output',
    )
    assert.equal(has(returning, 'Current listener only.'), false)

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
      () => activeRecognitions().length === 0,
      'disabling all targets releases provider sockets',
    )
    assert.deepEqual(
      (await f.json(await fetch(`${f.web.origin}/api/player/config`))).outputLanguages,
      [],
    )
  },
)
