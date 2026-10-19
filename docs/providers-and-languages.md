# OpenAI provider configuration

The administrator enters one **OpenAI API Key**. Model names and destinations
are fixed in server code. No region, endpoint, second key or model selection is
required. Administration contains only the website-wide key and game terms.
Production setup provisions and validates Simplified Chinese (`zh-Hans`),
Japanese (`ja`) and Korean (`ko`) with that key; no manual language setup is
required in administration. Missing credentials never produce fabricated paths.

| Purpose                   | Model                                   | Connection                                               |
| ------------------------- | --------------------------------------- | -------------------------------------------------------- |
| Shared original captions  | `gpt-live-transcribe`, `delay: minimal` | `/v1/realtime?intent=transcription`                      |
| Direct speech translation | `gpt-realtime-translate`                | `/v1/realtime/translations?model=gpt-realtime-translate` |

Both connections use `wss://api.openai.com` and server-only Authorization headers.
Translation consumes incoming audio directly and runs concurrently with original
caption recognition. It never waits for a completed source transcript. One target
session is shared by listeners using that target language for that speaker.

The supported target language families are `es`, `pt`, `fr`, `ja`, `ru`, `zh`,
`de`, `ko`, `hi`, `id`, `vi`, `it` and `en`. BCP 47 region variants map to the
corresponding provider language. `zh-Hans` and `zh-Hant` use the same Chinese
translation target, followed by local OpenCC script normalization. This converts
writing system; it does not guarantee a regional translation vocabulary.
Unsupported targets fail validation and cannot be enabled.

Sources: [OpenAI realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription),
[realtime translation](https://developers.openai.com/api/docs/guides/realtime-translation),
and [translation implementation guide](https://developers.openai.com/cookbook/examples/voice_solutions/realtime_translation_guide).

## Credential protection and revisions

Credentials are AES-256-GCM encrypted with the existing protected server key,
using the configuration ID as authenticated context. Reads return only whether
a credential is configured. Neither keys nor encrypted envelopes reach players,
exports, logs or audit metadata. The server encryption key remains deployment
configuration in the private infra repository; the administrator does not enter it.

Management requires a verified Access identity, its persisted administrator
session and the configured same origin for mutations. The existing versioned
provider API retains encrypted revision history, tested replacement/restore,
35-second cross-process test leases, a 10-second test cooldown and rejection of
stale results. A blank key on edit retains the saved key. One configuration may
serve both recognition and translation references; its lease is acquired once.
Conflicting reference versions reject before provider work.

A connection probe opens and configures both actual model sessions in parallel.
It verifies key/model access, without claiming that audio or language quality was
validated. Errors are reduced to safe credential, model, quota, rate, permission,
configuration, response, timeout or availability categories. Untrusted endpoint
settings are rejected; upstream error messages are never forwarded.

Migration 0014 disables and clears unsupported provider paths and their proofs,
clears disabled room defaults, removes retired provider configurations and their
cascaded encrypted history, and advances the language catalog. It seeds no key,
language or proof. Operator-supplied credentials belong only in encrypted runtime
storage.

## Audio sample comparison

An authorized administrator can upload 0.2–10 seconds of mono PCM16 WAV at 16 or
48 kHz, at most 1 MB. The JSON limit is 1,400,000 bytes, including chunked requests.
Audio is paced in 20 ms frames and converted once to 24 kHz PCM16. Silence stays
in the timeline. The finite sample waits for its target connection, then uses the
same streaming engine as the worker. The sample comparison is displayed when the
finite operation completes; live player captions are delivered incrementally.

Samples have a 30-second deadline. They retain up to 32 bounded display windows,
not a fabricated alignment of source and translated utterances. The original
caption stream is marked independent, source language is `und`, and timestamps
are null because this model does not supply dependable per-utterance alignment
between these separate sessions. Translation is final only after `session.close`
is drained through `session.closed`. Validation requires nonempty completed
source and translated output, checked against the saved path and catalog versions.

Recognition terms become `prompt`, `keywords` and language hints. Generated
recognition context has a 6,000-byte budget; terms are never silently truncated.
The translation model does **not** support custom prompts, glossaries or
pronunciation guides. Saved target-language terminology remains catalog data for
manual evaluation; it is not sent through an unsupported translation parameter.

The translation model can omit speech already in the target language. Source
captions and original audio remain available. The application does not infer a
source language or relabel untranslated text as a translation. Test mixed-language
commands, names and terminology explicitly before enabling production languages.
