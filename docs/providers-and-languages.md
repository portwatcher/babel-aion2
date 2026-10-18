# Providers and output languages

## Current state

The administrator can create, edit, test, restore and remove encrypted candidate
configurations. Soniox is a recognition candidate; DeepL is a separate text
translation candidate. Every saved configuration stays `enabled: false` and the
public language list stays empty. The UI distinguishes a connection test from
speech/subtitle quality. There is no enable operation or player-defined endpoint.

`@babel/providers` makes real protocol requests when used with real credentials.
Local validation substitutes loopback HTTP/WebSocket servers only in test processes.
No real provider credential or authorized battle speech sample has been supplied;
live access, latency, quality and provider selection remain **NOT RUN**.
The Soniox recognition stream, shared language jobs and speech-to-subtitle path
are not implemented. The DeepL text function is used by its connection test but
is not connected to a subtitle pipeline.

## Candidate APIs and test scope

| Candidate | Implemented request                                                                                                              | What a successful test establishes                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Soniox    | Fixed `wss://stt-rt.soniox.com/transcribe-websocket`, API-key subprotocol, configurable realtime model, raw mono s16le at 48 kHz | One second of generated silence is acknowledged as processed, followed by a finished response   |
| DeepL     | `POST /v2/translate` on the official Free or Pro origin, `DeepL-Auth-Key` header, explicit model type                            | The fixed short sentence “Wait here.” produces one valid English-to-German translation response |

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

## Administration and persistence

All operations require a verified Access JWT, its matching persisted Better Auth
session, and the configured same origin for mutations. Responses are private and
not cacheable. The UI uses HTTP; it adds no administrator WebSocket.

| Operation                                           | Route and body                                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| List configurations and latest 20 history summaries | `GET /api/management/providers`                                                              |
| Create with a client-generated UUID                 | `PUT /api/management/providers/:id`, `expectedVersion: 0`, name, settings and credential     |
| Update                                              | Same PUT with the current positive version; omit credential to retain it                     |
| Test saved settings                                 | `POST /api/management/providers/:id/test`, current `expectedVersion`                         |
| Restore old settings                                | `POST /api/management/providers/:id/restore`, current `expectedVersion` and `restoreVersion` |
| Remove configuration and encrypted history          | `DELETE /api/management/providers/:id`, current `expectedVersion`                            |

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

Soniox sends 20 ms frames and stops if its pending send buffer exceeds 500 ms.
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
languages still remain empty. Language-path administration, full validation,
shared recognition/translation work, delayed-result fencing and PiP are unfinished.

Before enabling `zh-Hans`, `ja`, `ko` or another language, implement and validate
its whole path with authorized samples, compare measured candidates, then expose
the administrator's provider/path selection. Release unused shared work after a
short delay. Provider failures must leave original audio independent and must
not silently switch the requested language.
