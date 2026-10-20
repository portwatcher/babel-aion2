# Streaming subtitles

Each active Discord member has an independent mono audio timeline. Original
playback remains on its existing media path. Caption processing fans the same
20 ms PCM frame out concurrently to `gpt-live-transcribe` and one
`gpt-realtime-translate` session per requested target language. Listeners sharing
a speaker and language share the target connection. No text translation request,
utterance wait or 250 ms scheduling window remains.

## Continuous processing and bounds

Stereo 48 kHz Discord PCM is downmixed per member and converted once to 24 kHz
PCM16. All targets reuse the encoded frame, including actual silence. WebSockets
disable message compression and TCP packet coalescing. A provider send backlog
over approximately 100 ms fails the affected connection instead of accumulating
obsolete commands. Recognition and translation handshakes run in parallel; audio starts with the first
ready session. A connecting session
keeps only the newest five frames (100 ms), marks discontinuity if older audio is
lost, and never delays ready targets. The worker drops pre-ready audio
instead of replaying seconds of history after a cold connection.

Every translation delta is appended exactly as received and published immediately.
Event IDs deduplicate repeated packets; equal `elapsed_ms` values do not discard
distinct fragments. Source recognition runs with `delay: minimal` and local source
endpointing after 120 ms of silence or five seconds of continuous input. Source
commits affect source finality only; translation never waits for them. An ending
sample pads a sub-100-ms tail so the provider can commit its final source buffer.

A continuous translation stream has no utterance-done event. Sentence boundaries and a 2,048-character limit define
display windows carry a sequence/revision, and finality is set only after the
provider acknowledges a drained session close. An independent source stream is
shown as such; the application does not invent source timestamps, language
identification, speaker labels or one-to-one source/target utterance alignment.
Chinese script formatting uses OpenCC locally on the accumulated window.

Late subscribers receive subsequent fragments without replaying an accumulated
prefix. Input/output alignment metadata does not establish which spoken utterance
a fragment represents. New fragments arriving after subscription can still concern
speech that was in flight at the provider. Source, stream, configuration and
subscription generations continue to fence obsolete connections and work.

Transient target connection faults retry independently with bounded exponential
backoff. Permanent key/quota/model faults remain visible until configuration is
corrected. No target failure switches the selected language or restarts original
audio. Only currently subscribed languages open target connections. The last
unsubscribe immediately fences and closes that target, discards connecting audio
and cancels retries. A later subscriber opens a fresh connection. When no subtitle
listeners remain, the worker closes recognition too, even if output languages
remain enabled. Original audio continues independently. Sessions rotate at 50 minutes and
also honor the provider's actual `expires_at`; reconnecting clears stale text.

## Receive, push and display

The private worker `/subtitles` HTTP response flushes its headers and streams
NDJSON as events arrive. Every 500 ms one query confirms every subscriber's
listener/nickname/subscription fence and another reads the room sources and
path/provider/term versions. An event is sent only while its subscriber and path
were confirmed within the last 1.5 seconds; a newer source generation than the
snapshot is confirmed with one room query first. Revocation closes the player
socket, which carries every subtitle, before acknowledging. There is no
intentional send delay. Unsent obsolete revisions
are replaced immediately; a consumer queue is bounded to 16 events and HTTP
buffering to 256 KiB. Slow clients close instead of falling progressively behind.

The web relay reads each complete line and immediately emits it on the existing
revocable player WebSocket. Vue updates its shared presentation for every accepted
revision; the main page and Document PiP use the same state. No polling or debounce
is used for player captions. Administration keeps ordinary HTTP and polling.

Both views show the translation first and the original text beneath it, with a
smaller, muted type size and a localized source-finality label. Source text appears
as soon as it is available, without a disclosure or waiting for translation.
Both rows wrap without truncation and follow the existing text-size setting.
This uses the existing `originalText` payload; it adds no provider request, network
subscription or synchronization wait. The independent streams are not presented
as having sentence-by-sentence alignment.

Source and credential replacement close obsolete provider sockets. Changed player
languages abort the previous private subscription and clear page/PiP state while
preserving listener identity and original audio. Nickname replacement still waits
for actual previous socket and media closure. Database authorization failures stop
subtitle delivery without bypassing the original media path's independent checks.

## Evidence and limits

Protocol tests use real loopback WebSocket handshakes and frames with explicitly
synthetic transcript events. The database integration test uses the built web app,
private HTTP, actual player WebSockets and a real WebRTC receiver. These exercise
fragment delivery, shared languages, a held target, independent faults, source
replacement, late listeners, nickname revocation and physical socket release.

An authorized synthetic English speech probe against the real OpenAI API passed
for Japanese, Korean and Chinese: first original text at 772 ms; first translation
at 1,092 / 3,327 / 2,324 ms respectively, measured from the start of paced audio
after all handshakes. All three produced incremental text before the 5,644 ms clip
ended and drained successfully. Cold handshake preparation took 1,080 ms. This is
one sample, not a percentile benchmark, quality evaluation or full Discord-to-screen
latency measurement. Model lookahead, network distance, cold starts and browser
render scheduling remain real latency contributors. See [validation](test-report.md).
Production speech-to-screen latency is traced per speech turn; see
[latency tracing](latency-tracing.md).
