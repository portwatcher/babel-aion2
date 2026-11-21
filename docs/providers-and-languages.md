# OpenAI provider configuration

The administrator enters one **OpenAI API Key**. Model names and destinations
are fixed in server code. No region, endpoint, second key or model selection is
required. Administration contains only the website-wide key and game terms.
Production setup provisions and validates English (`en`), Simplified Chinese (`zh-Hans`),
Japanese (`ja`) and Korean (`ko`) with that key; no manual language setup is
required in administration. Missing credentials never produce fabricated paths.

| Purpose                    | Model                                   | Connection                                              |
| -------------------------- | --------------------------------------- | ------------------------------------------------------- |
| Shared original captions   | `gpt-live-transcribe`, `delay: minimal` | `wss://api.openai.com/v1/realtime?intent=transcription` |
| Streaming text translation | `gpt-4.1-nano` (`stream: true`)         | `https://api.openai.com/v1/chat/completions`            |

Both endpoints use `api.openai.com` and server-only Authorization headers.
One VAD-gated recognition stream runs per active speaker; streaming SSE text
translation runs per subscribed target language from incremental and finalized
transcripts, sharing one request per target language across listeners.

The supported target language families are `es`, `pt`, `fr`, `ja`, `ru`, `zh`,
`de`, `ko`, `hi`, `id`, `vi`, `it` and `en`. BCP 47 region variants map to the
corresponding provider language. `zh-Hans` and `zh-Hant` specify Simplified or
Traditional Chinese in the translation prompt, followed by local OpenCC script
normalization. Unsupported targets fail validation and cannot be enabled.

Sources: [OpenAI realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
and [chat completions streaming](https://platform.openai.com/docs/api-reference/chat/create).

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

A connection probe configures the recognition WebSocket session and executes a
1-token `gpt-4.1-nano` completion probe in parallel.
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
Audio is paced in 20 ms frames, converted once to 24 kHz PCM16, and gated by local
VAD (160 ms pre-roll, 120 ms trailing hangover) so pure silence is not streamed.
The finite sample waits for the recognition handshake, then uses the same
streaming engine as the worker. The sample comparison is displayed when the
finite operation completes; live player captions are delivered incrementally.

Samples have a 30-second deadline. They retain up to 32 utterance-aligned
segments (`sourceAlignment: 'aligned'`), source language is locally estimated
(or `und` when uncertain), and audio timestamps remain null. Validation requires
every non-empty recognized utterance to reach final source and translated output,
checked against the saved path and catalog versions.

Recognition terms become `prompt`, `keywords` and language hints; matching
target-language expressions become a required terminology glossary for
`gpt-4.1-nano` translation (`translationTermCount`). Both contexts enforce a
6,000-byte UTF-8 budget; terms are never silently truncated.

For every output language, a matching local source-language estimate selects the
shared transcript directly, including its revisions and finality, with zero
translation API requests. Regional variants match their language family; Chinese
script choices use local normalization. Different or uncertain source languages
stream `gpt-4.1-nano` translations. Test mixed-language commands, names and
terminology explicitly before enabling production languages.
