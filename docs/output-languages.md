# Output-language preparation and validation

Administrators can save output-language paths, order them, choose a default, and
validate a saved path with an authorized audio sample. This is preparation for
player subtitles. The worker and authorized player delivery are not connected;
activation fails closed and the public language list remains empty.

## Administrator workflow

1. Save a Soniox recognition candidate and a DeepL translation candidate in
   **字幕服务配置**. The same candidate can be shared by several languages.
2. Add an **输出语言** with a canonical BCP 47 code, a display name, both service
   references, and a choice of whether to include enabled game terms.
3. Use **验证样本路径** to select an authorized PCM WAV and inspect its source and
   translated text. The existing sample form and provider adapters handle it.
4. Reorder languages and optionally select a default. These choices are saved
   but do not expose a language to players before activation is implemented.

Codes are immutable after creation. Simplified and Traditional Chinese use
separate `zh-Hans` and `zh-Hant` paths; provider adapters map these site codes to
provider parameters. Display names are plain text of 1–80 characters without
control/format characters. No production language is prepopulated.
The API requires canonical codes and rejects unknown `und`; the editor
canonicalizes input before saving. A code's syntactic validity does not establish
provider support. Only the actual selected provider path can test that support.

## What validation records

The validation endpoint reads the language's stored service references, output
code and terminology policy. Clients cannot substitute a provider or output code
in the sample request. The normal bounded sample operation owns both provider
test leases. Audio and text go to the selected official providers; requests may
incur charges. See [sample limits](providers-and-languages.md#audio-sample-comparison).

The stored result contains the check time, path version, provider IDs/versions,
terminology catalog version when included, audio duration, stable-utterance
count and a safe result code. It contains no audio, transcript, translated text,
credential or provider error message. A successful proof requires at least one
nonempty stable source utterance and completed translations for all nonempty
utterances. It establishes that the sample path processed text, not translation
accuracy, live latency, player authorization or game suitability.

The latest attempt is separate from the last successful validation. A transient
quota/service failure updates the attempt without erasing the prior success.
The UI shows both current-proof status and the most recent attempt. A proof is
current only while its path, provider revisions and included terminology revision
match. Even a provider name-only revision conservatively makes it stale. Renaming
or reordering a language preserves its path version and proof. Changing its
provider references or terminology policy starts a new path version and clears
the old proof and attempt.

The final transaction rechecks the language, provider and terminology snapshot.
Concurrent changes return 409 and cannot stamp a replacement path with old
evidence. No network request is held inside a database transaction. Failed
language-proof persistence can still leave the normal metadata-only provider
sample audit, since provider processing actually occurred.

## Persistence and API

All routes require a verified Cloudflare Access identity and its matching
persisted Better Auth session. Mutations also require the configured same origin.
Administration uses HTTP and private, noncacheable responses.

| Operation          | Route and body                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| List               | `GET /api/management/languages`; 50 entries per page                                                                                            |
| Next page          | Same GET with `offset` and `expectedVersion` from the first page                                                                                |
| Create             | `PUT /api/management/languages/:code`, `expectedVersion: 0`, `name`, `recognitionConfigurationId`, `translationConfigurationId`, `includeTerms` |
| Edit               | Same PUT with the current entry `expectedVersion`                                                                                               |
| Validate           | `POST /api/management/languages/:code/validate`, current `expectedVersion` and canonical `audioBase64`                                          |
| Move               | `POST /api/management/languages/:code/move`, current `expectedCatalogVersion`, `direction: "up"` or `"down"`                                    |
| Default            | `POST /api/management/languages/default`, current `expectedCatalogVersion`, `code` or `null`                                                    |
| Disable            | `POST /api/management/languages/:code/state`, current `expectedVersion`, `enabled: false`                                                       |
| Request activation | Same state route with `enabled: true`; currently always rejected                                                                                |
| Delete             | `DELETE /api/management/languages/:code`, current `expectedVersion`; language must be disabled                                                  |

Ordinary mutation bodies are limited to 32 KiB; sample JSON to 1,400,000 bytes.
Unknown fields are rejected. Referenced configurations must exist and have the
correct Soniox/DeepL roles. A provider cannot be deleted while any language,
including a disabled language, references it. Deleting a language clears matching
room defaults. The default uses the existing room field; no second default store
is introduced and room/source configuration generations do not change.

The global language catalog serializes mutations and supplies monotonically
increasing entry versions, including after deletion/recreation. Stale updates,
moves, defaults and paginated reads fail with 409. Path versions advance only
when the service path changes. Ordering swaps the adjacent entries atomically.
The initial migration normalizes existing sort positions and initializes the
catalog without adding languages. Preserve the catalog, language rows, room
defaults, provider revisions and terminology catalog together in backups.

## Remaining activation gate

An enable request without a current proof returns `PATH_UNVALIDATED` (409).
With a current sample proof it returns `DELIVERY_UNAVAILABLE` (503). There is no
test flag or positive activation path. The UI explains this and disables enable
controls. Public configuration continues to omit all prepared languages.

Before activation can ship, connect the shared engine to real source/language
demand, prove generation-fenced player subtitle delivery, implement language-list
notifications and subscription fallback, and validate actual provider access and
speech quality. Disabling an active language must update current subscribers
without interrupting original audio; those live transitions remain unfinished.
