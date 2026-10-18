# Providers and output languages

## Current state

The administrator can create, edit, test, restore and remove encrypted candidate
configurations. Soniox is a recognition candidate; DeepL is a separate text
translation candidate. Saved configurations remain candidates; the separate
language state controls live use. The UI distinguishes a connection test from
speech/subtitle quality. There is no player-defined provider endpoint.
The separate [output-language editor](output-languages.md) references these
candidates and persists version-bound sample validation, ordering and defaults.
It can activate a currently validated path when the private worker is ready.
Production starts with no configured languages.

`@babel/providers` makes real protocol requests when used with real credentials.
Local validation substitutes loopback HTTP/WebSocket servers only in test processes.
No real provider credential or authorized battle speech sample has been supplied;
live access, latency, quality and provider selection remain **NOT RUN**.
The Soniox recognition adapter handles real-time transcript revisions and utterance
endpoints. Its audio-sample operation feeds current utterance revisions to the
separate DeepL adapter while recognition continues. The [shared processing engine](streaming-subtitles.md)
coalesces revisions and shares work among language subscribers. The Discord
worker and language-demand coordinator now deliver its output through authorized
player connections. This does not turn fixture results into live quality evidence.

## Candidate APIs and test scope

| Candidate | Implemented request                                                                                                                    | What a successful test establishes                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Soniox    | Fixed `wss://stt-rt.soniox.com/transcribe-websocket`, API-key subprotocol, configurable realtime model, raw mono `pcm_s16le` at 48 kHz | One second of generated silence is acknowledged as processed, followed by a finished response   |
| DeepL     | `POST /v2/translate` on the official Free or Pro origin, `DeepL-Auth-Key` header, explicit model type                                  | The fixed short sentence “Wait here.” produces one valid English-to-German translation response |

Both tests can incur provider charges. Saving a new candidate does not send a
request. Testing saved settings, changing an existing connection parameter/key,
or restoring historical settings does. No microphone or Discord audio is used.
Silence completion cannot prove speech accuracy; one text response cannot prove
quality for Chinese, Japanese, Korean or battle terminology.

The API comparison follows Soniox's [WebSocket reference](https://soniox.com/docs/api-reference/stt/websocket-api)
and [authentication guide](https://soniox.com/docs/guides/websocket-authentication),
and DeepL's [translation reference](https://developers.deepl.com/api-reference/translate/request-translation)
and [authentication guide](https://developers.deepl.com/docs/getting-started/auth).
Soniox consumes audio and reports processing completion; DeepL consumes text and
has distinct Free/Pro origins and model choices. These are candidates for separate
recognition and translation stages, not a measured ranking or final selection.

## Audio-sample comparison

In **音频样本测试**, select a saved Soniox candidate, a separate saved DeepL
candidate, an output-language code and an authorized WAV file. The format is mono,
16-bit little-endian PCM at 16 or 48 kHz, 0.2–10 seconds, at most 1,000,000 bytes.
The server rejects invalid RIFF/chunk sizes, duplicate format/data chunks,
compressed or stereo audio, unsupported sample rates and excessive duration.
It bounds the JSON request to 1,400,000 bytes while reading, including chunked input.
The sample operation has a total 30-second provider deadline.
Sample language codes must identify an actual language; `und` is not an output
choice. Recognition can still report `und` when source language is unknown.

Audio is sent to Soniox in paced 20 ms frames; silence is retained. Text and
sample-relative audio timestamps come from the provider. Final tokens accumulate
once, each response replaces its provisional tokens, and `<end>`/`<fin>` closes an
utterance. Revisions replace earlier text under the same utterance ID. Missing
timestamps remain `null`; absent or mixed source-language evidence becomes `und`,
which lets DeepL detect the source instead of inventing an intermediate language.
Each utterance is bounded to 4096 characters/tokens and each sample to 32 utterances.
These are processing limits, not an acceptance sample-count requirement.

Current utterances are translated during recognition. Provisional updates are
coalesced; corrected source clears and supersedes an obsolete translation. An
unchanged text can reuse its translation when only finality changes. The page
returns the comparison after processing ends and shows original/translated text,
separate source/translation finality, known sample times, configuration
versions and elapsed processing time. This elapsed time is not a measurement of
live subtitle latency. `PASS` means the request finished with valid responses;
the administrator must still compare accuracy, negation, numbers and terminology.
An entirely empty transcript makes no translation request. `NO_SPEECH` means no
stable nonempty utterance remains; a provisional utterance withdrawn later may
already have incurred a translation request. Safe provider failures remain visible
with any partial original text. The operation does not enable configurations,
modify connection-test evidence, create a language or send anything to players.

Audio reaches Soniox and recognized text reaches DeepL, so use authorized samples
and expect provider charges. Babel keeps sample content only in request memory
and the current page; it does not persist audio, transcript or translated text.
The audit records only configuration IDs/versions, the catalog revision when used,
and the safe result code.
Provider retention policies are separate from Babel's storage behavior.
Samples use the enabled [game terminology catalog](game-terms.md) by default.
The optional `includeTerms: false` request field disables its context for a
comparison. Results identify the catalog revision and context entry counts;
catalog changes during processing reject obsolete results. The context is sent
to the relevant provider and remains separate from the actual text to translate.
The browser can play the selected local file without uploading it until the
administrator starts the test.

This bounded comparison is not continuous live subtitle delivery. It follows the
Soniox [token update protocol](https://soniox.com/docs/stt/rt/real-time-transcription)
and [endpoint markers](https://soniox.com/docs/stt/rt/endpoint-detection).

## Administration and persistence

All operations require a verified Access JWT, its matching persisted Better Auth
session, and the configured same origin for mutations. Responses are private and
not cacheable. The UI uses HTTP; it adds no administrator WebSocket.

| Operation                                           | Route and body                                                                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| List configurations and latest 20 history summaries | `GET /api/management/providers`                                                                                                                |
| Create with a client-generated UUID                 | `PUT /api/management/providers/:id`, `expectedVersion: 0`, name, settings and credential                                                       |
| Update                                              | Same PUT with the current positive version; omit credential to retain it                                                                       |
| Test saved settings                                 | `POST /api/management/providers/:id/test`, current `expectedVersion`                                                                           |
| Restore old settings                                | `POST /api/management/providers/:id/restore`, current `expectedVersion` and `restoreVersion`                                                   |
| Compare an audio sample                             | `POST /api/management/providers/sample`, `recognition: {id, version}`, `translation: {id, version}`, `outputLanguage`, canonical `audioBase64` |
| Remove configuration and encrypted history          | `DELETE /api/management/providers/:id`, current `expectedVersion`                                                                              |

Provider type cannot change within a configuration. Create another configuration
for a different provider. DeepL selects Free/Pro origin and one of its three
documented model types; Soniox accepts a model identifier. There is no arbitrary
endpoint field. Unknown fields, including `enabled`, are rejected.

Every successful edit advances the version. Existing connection or credential
changes run a candidate probe before the transaction replaces anything. A failed
probe returns a safe classification and leaves the previous version, ciphertext,
settings and saved test result intact. A successful replacement snapshots the
old encrypted settings. Restoring history re-tests those settings and creates a
new monotonically increasing version. A name-only edit retains the previous
connection result and its original test timestamp.

Each configuration has one database-backed test lease (35 seconds) and a minimum
10-second interval between test starts. Tests have a configurable 1–30 second
deadline; the default is 15 seconds. A one-second Soniox deadline may expire before
the one-second audio stream and final response finish. Concurrent tests return
409, cooldown violations 429, and stale versions 409. A late result cannot update
a replaced configuration or a lease owned by a different request. A crashed
process's lease expires without changing the last accepted configuration.
An audio sample acquires both configurations' test leases and uses the same
cooldown. It checks both versions and lease owners after processing; an obsolete
result returns 409 instead of being presented as current evidence. Leases are
released on success or failure. Audio validation happens before provider requests.

Deletion refuses configurations referenced by any output-language row, including
disabled rows, and refuses an active test lease. It deletes all historical
credentials with the configuration. There is no general configuration export.

## Credentials and response limits

`NUXT_PROVIDER_ENCRYPTION_KEY` is the protected, canonical base64-encoded 32-byte
server key. Keep it in the existing infra secret store, separately from database
backups. AES-256-GCM uses a fresh nonce and authenticated provider ID/purpose;
ciphertext copied from another configuration is rejected. Current and historical
credentials are encrypted. Reads expose only credential presence and allowlisted
configuration/history fields, never saved plaintext or ciphertext. Audit rows
contain identifiers, versions, change flags and safe test codes, not request bodies,
provider messages or translated text. Missing keys fail closed.

Names allow 1–80 characters without control/format characters. Credentials allow
1–4096 printable ASCII characters without spaces. DeepL requests accept one text
of up to 8192 characters and an optional context of the same limit. Responses are
bounded to 64 KiB while reading and require exactly one nonempty translation.
The language mapping preserves Chinese writing systems; unsupported provider
language combinations still require path validation.

Soniox sends frames of at most 20 ms and stops if its pending send buffer exceeds
500 ms. Input sample offsets must be contiguous; a discontinuity fails the stream
instead of silently joining separate fragments. A paused open stream sends a
documented keepalive every 10 seconds. It ends after 295 minutes, before the
documented 300-minute session limit; the continuous worker rotates at 290 minutes
and advances stream generation. There is no automatic replay of old audio.
The probe requires a finished response after all frames, with at least 1000 ms
processed; early completion, malformed responses and timeout fail. Soniox
responses over 64 KiB are rejected. HTTP translation redirects are rejected to
avoid forwarding authorization to another destination.

Safe results distinguish invalid credentials, quota exhaustion, rate limits,
timeouts, denied access, malformed/incomplete responses and unavailable services.
Soniox's documented model error maps to `MODEL_UNAVAILABLE`. DeepL HTTP 400 maps
to rejected settings; the code does not guess model availability from an arbitrary
error message. Provider-specific live error cases remain part of the live gate.

## Output language selection and remaining work

`selectOutputLanguage` selects a valid saved code first, then browser preferences
in order, then the configured default, then the first enabled language, then
`null`. It canonicalizes codes, tries an exact match, and matches a language only
when its writing system is compatible. Tests include `ja-JP` → `ja`, `ko-KR` →
`ko`, and `zh-CN` → `zh-Hans`. Traditional and Simplified Chinese remain distinct.

The player supplies browser preferences and saves explicit choices locally.
Changing a subscription preserves the listener session/generation. Production
languages remain empty until configured. Language-path administration, sample
validation, worker/player delivery and shared PiP content are implemented.

Before enabling `zh-Hans`, `ja`, `ko` or another language, implement and validate
its whole path with authorized samples and compare quality. The administrator
selects and enables validated paths. Unused work is released after a short delay.
Provider failures preserve original audio and the selected language; the page
shows its fault. Live quality, latency and production capacity remain unverified.
