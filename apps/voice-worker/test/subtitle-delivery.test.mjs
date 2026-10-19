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
  'continuous direct-audio subtitles reach current player sockets while original audio and other languages remain independent',
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
    const active = (protocol) =>
      f.network.observations.filter(
        (value) =>
          value.protocol === protocol && !value.closed && value.frames.length > 2,
      )
    f.speak('speaker-one', '同名测试成员')
    await until(
      () => active('recognition').length === 1 && active('translation').length === 2,
      'shared recognition and two direct-audio target sockets',
    )
    const recognition = active('recognition')[0]
    assert.equal(recognition.configuration.audio.input.format.rate, 24000)
    assert.ok(
      active('translation').every((value) =>
        value.frames.every((frame) => frame.bytes === 960),
      ),
    )
    const source = (text, selected = recognition) =>
      f.network.emit(
        f.recognitionKey,
        {
          type: 'conversation.item.input_audio_transcription.delta',
          item_id: randomUUID(),
          delta: text,
        },
        selected,
      )
    const target = (
      language,
      text,
      selected = active('translation').find(
        (value) => value.configuration.audio.output.language === language,
      ),
    ) =>
      f.network.emit(
        selected.key,
        {
          type: 'session.output_transcript.delta',
          event_id: randomUUID(),
          elapsed_ms: 200,
          delta: text,
        },
        selected,
      )
    source('Wait here.')
    target('ja', 'Wait here JA. ')
    target('ko', 'Wait here KO. ')
    await until(
      () =>
        has(a, 'Wait here JA.') && has(b, 'Wait here JA.') && has(c, 'Wait here KO.'),
      'partial text crosses private HTTP and public player WebSocket',
    )
    const caption = a
      .values()
      .find((value) => value.translatedText.includes('Wait here JA.'))
    assert.equal(caption.speakerId, 'speaker-one')
    assert.equal(caption.sourceAlignment, 'independent')
    assert.equal(caption.audioStartMs, null)
    assert.equal(
      caption.translationIsFinal,
      false,
      'continuous transcript is provisional until session closure',
    )
    assert.equal(
      active('translation').length,
      2,
      'same-language players share one translation session',
    )
    const late = await f.enter('subtitle-late', 'ja')
    await until(() => late.subtitles().length, 'late subscriber attached')
    const hold = f.network.hold(f.translationKey)
    target('ja', 'Held Japanese. ')
    await hold.started
    const before = packets
    source('Keep receiving.')
    await until(
      () => packets > before + 10,
      'audio continues while translated output is held',
    )
    hold.release()
    await until(
      () => has(late, 'Held Japanese.'),
      'late player receives subsequent fragments',
    )
    assert.equal(
      has(late, 'Wait here JA.'),
      false,
      'never replay the accumulated prefix to a late listener',
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
    target('ko', 'New Korean. ')
    await until(
      () => has(a, 'New Korean.'),
      'language change receives following fragments',
    )
    assert.equal(
      active('recognition')[0],
      recognition,
      'language switching retains shared source connection',
    )

    const obsolete = f.network.hold(f.translationKey)
    target('ja', 'Obsolete source. ')
    await obsolete.started
    await f.replaceSource()
    await until(
      () =>
        recognition.closed &&
        active('recognition').length === 1 &&
        active('translation').length === 2,
      'source generation physically replaces all old sockets',
    )
    obsolete.release()
    const fresh = active('recognition')[0]
    source('Fresh source.', fresh)
    target('ja', 'Fresh Japanese. ')
    target('ko', 'Fresh Korean. ')
    await until(
      () => has(a, 'Fresh Korean.') && has(b, 'Fresh Japanese.'),
      'fresh source reaches current listeners',
    )
    assert.ok(
      a
        .values()
        .filter((value) => value.translatedText.includes('Fresh Korean.'))
        .every((value) => value.sourceGeneration === 4),
    )
    assert.equal(
      [a, b, c, late].some((client) => has(client, 'Obsolete source.')),
      false,
    )

    const japanese = active('translation').find(
      (value) => value.configuration.audio.output.language === 'ja',
    )
    f.network.emit(
      japanese.key,
      { type: 'error', error: { code: 'insufficient_quota' } },
      japanese,
    )
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
    target('ko', 'Korean still works. ')
    await until(
      () => has(a, 'Korean still works.'),
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
    target('ko', 'Current listener only. ')
    await until(
      () => has(replacement, 'Current listener only.'),
      'replacement receives fresh fragments',
    )
    assert.equal(a.values().length, oldCount)
    for (const client of [b, c, late, replacement]) {
      client.socket.close()
    }
    await until(
      () => active('recognition').length === 0 && active('translation').length === 0,
      'last subtitle listener releases all provider sockets while languages remain enabled',
      1500,
    )
    const returning = await f.enter('subtitle-returning', 'ko')
    await until(
      () => active('recognition').length === 1 && active('translation').length === 1,
      'returning listener opens only its requested target',
    )
    target('ko', 'Returning listener only. ')
    await until(
      () => has(returning, 'Returning listener only.'),
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
      () => active('recognition').length === 0 && active('translation').length === 0,
      'disabling all targets releases provider sockets',
    )
    assert.deepEqual(
      (await f.json(await fetch(`${f.web.origin}/api/player/config`))).outputLanguages,
      [],
    )
  },
)
