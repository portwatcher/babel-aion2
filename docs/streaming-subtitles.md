# Streaming subtitles

Each active Discord member has an independent mono audio timeline. Original
playback remains on its existing media path. Caption processing opens a
recognition WebSocket (`gpt-live-transcribe`, `delay: minimal`) only after the
member actually produces voiced audio, gates prolonged silence locally, and
streams incremental text translations (`gpt-4.1-nano` SSE over
`/v1/chat/completions`) per subscribed target language. Listeners sharing a
speaker and language share the translation request.

## VAD silence gating, idle release and bounds

Stereo 48 kHz Discord PCM is downmixed per member and converted once to 24 kHz
PCM16. While no speech is active, `openRecognition` retains a rolling 160 ms
(eight-frame) pre-roll buffer in memory without sending frames over the network.
When voiced energy arrives, the pre-roll frames and speech stream immediately so
initial consonants are not clipped. After 120 ms of trailing silence, the worker
commits the spoken utterance and closes the VAD gate; prolonged silence sends
zero provider audio frames. Continuous speech commits an intermediate chunk at
five seconds while keeping the gate open. An ending finite sample pads a
sub-100-ms voiced tail before committing.

In live rooms, silent unmuted microphones do not open recognition sessions. An
open speaker session that receives no voiced audio for 90 seconds closes cleanly
(`reason: 'idle'`) and returns listeners to `WAITING` until that speaker talks
again. Active sessions still rotate at 50 minutes and honor the provider's
`expires_at`.

Both host-capture and Discord subtitle streams schedule frames against the
monotonic clock. A late timer callback forwards every due 20 ms frame rather than
one frame per callback. Queue overflow or a stall more than 100 ms behind the
next due frame retires the stream and discards obsolete audio. WebSockets disable
message compression and TCP packet coalescing; a recognition send backlog over
approximately 100 ms fails the socket rather than accumulating stale commands.
A connecting recognition session retains only the newest five frames (100 ms),
marks discontinuity if older audio is lost, and drops pre-ready history.

## Utterance-aligned streaming text translation

Every recognized utterance carries a stable `utteranceId` (`sourceAlignment:
'aligned'`). Rapid provisional recognition deltas coalesce over a 40 ms window
while streaming SSE tokens from `gpt-4.1-nano` immediately as they arrive;
single-flight scheduling prevents abort starvation on longer sentences while
keeping only the latest pending revision queued. When a finalized transcript
matches the already-translated delta text, `translationIsFinal` is set
immediately with zero duplicate API requests. Chinese output specifies the
requested script in the translation prompt and applies OpenCC normalization
locally.

Every output reuses live transcription directly whenever the locally identified
source language matches its target language family, spending zero translation
requests. Regional BCP 47 variants match that family, and Chinese text retains
local Simplified/Traditional normalization. Different and uncertain source
languages stream `gpt-4.1-nano` translations. Language identification uses the
larger local ELD model; a local Franc check distinguishes Indonesian when ELD
reports Malay.

Late subscribers never receive pre-subscription utterances or re-translated
prefixes from an utterance that began before subscription. Source, stream,
configuration and subscription generations fence obsolete connections and
in-flight HTTP requests.

Transient translation faults (`TIMEOUT`, `UNAVAILABLE`, `RATE_LIMITED`) retry on
subsequent speech with bounded exponential backoff. Permanent credential, quota
or model faults remain visible until configuration is corrected. Only currently
subscribed languages run translations; the last unsubscribe immediately aborts
any in-flight HTTP request for that language. When no subtitle listeners remain,
the worker closes recognition too. Original audio continues independently.

Enabled game terms supply both bounded recognition hints (1,024-character prompt
limit plus full literal keywords and language hints) and target-language
translation glossaries (`translationTermCount`). Stream-end logs distinguish
provider failures, audio backlog, clock stalls, idle release and authorization
expiry, recording controlled codes, generations, elapsed duration, received
audio milliseconds and actual VAD-gated sent audio milliseconds without audio,
transcripts, terminology text, display names or credentials.

## Receive, push and display

The private worker `/subtitles` HTTP response flushes its headers and streams
NDJSON as events arrive. Every 500 ms one query confirms every subscriber's
listener/nickname/subscription fence and another reads the room sources and
path/provider/term versions. An event is sent only while its subscriber and path
were confirmed within the last 1.5 seconds; a newer source generation than the
snapshot is confirmed with one room query first. Revocation closes the player
socket, which carries every subtitle, before acknowledging. Unsent obsolete
revisions are replaced immediately; a consumer queue is bounded to 16 events and
HTTP buffering to 256 KiB. Slow clients close instead of falling behind.

The web relay reads each complete line and immediately emits it on the existing
revocable player WebSocket. Vue updates its shared presentation for every accepted
revision; the main page and Document PiP use the same state. Administration keeps
ordinary HTTP and polling.

Both views show the translation first and the original text beneath it, with a
smaller, muted type size and a localized source-finality label. Source text
appears as soon as recognition emits it, without waiting for translation tokens.
Both rows wrap without truncation and follow the existing text-size setting.

## Evidence and limits

Protocol tests exercise real loopback WebSocket handshakes and HTTP SSE streams
with synthetic recognition and translation responses, covering VAD silence
gating, pre-roll/hangover preservation, idle speaker release, terminology
glossary injection, single-flight coalescing, matching-language zero-cost reuse,
transient recovery and configuration fencing. The database integration test uses
the built web app, private HTTP, actual player WebSockets and a real WebRTC
receiver. Production speech-to-screen latency is traced per speech turn; see
[latency tracing](latency-tracing.md) and [validation](test-report.md).
