# Validation

## Player subtitle window and Discord credential check — 2026-10-18

The player panel now owns a feature-detected Document PiP presentation with shared
reactive status and text size. It is a status window until authorized live
subtitles are connected; this does not establish the full PiP/audio acceptance gate.

| Check                                      | Status                    | Evidence                                                                                                                                                                      |
| ------------------------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local CI                                   | PASS                      | `npm run ci:local`; 149 source files, maximum 494 lines, strict types, 14 existing tests, production builds and HTTP smoke                                                    |
| Browser open/close and keyboard activation | PASS                      | Built app in Chrome on macOS: click and Enter complete `requestWindow`, owner control changes to close, and closing returns to the open control without ending the listener   |
| Shared listener identity                   | PASS                      | Real PostgreSQL retains one current listener generation and one open socket after opening/closing PiP; no separate listener entry is created                                  |
| Text size and narrow layout                | PASS                      | Main-page extra-large status computes to 32 px; complete controls fit 320 px; no captured browser warnings/errors                                                             |
| Replacement and explicit exit UI           | PASS                      | Another actual browser entry replaces the old generation, displays the required terminal message and removes its listener panel; explicit leave also removes the panel        |
| Native PiP rendering and physical close    | NOT RUN                   | Native-app capture failed; browser read-only DOM inspection cannot access the separate PiP document. Main-page lifecycle state alone is not proof of native pixels or closure |
| Live subtitles, background audio and AION2 | NOT RUN                   | No live source/media adapter or authorized player subtitle delivery; no actual game/display-mode or player-network test                                                       |
| Discord credential                         | PASS                      | User-generated bot token saved only in ignored local `.env` with mode 0600; Discord `GET /users/@me` returns 200 and confirms the dedicated bot identity                      |
| Discord guild/voice receive                | WAITING FOR CONFIGURATION | `GET /users/@me/guilds` returns 200 with an empty list; bot installation, target voice channel and commander selection are pending                                            |

No credentials are included in source, this report or browser screenshots. No
production deployment was made. See [PiP implementation and limits](picture-in-picture.md).

## Output-language configuration and validation — 2026-10-18 (historical)

Administrators can prepare language paths, select service configurations and term
policy, order languages, choose a default, and persist sample validation against
the exact revisions used. The player language list remains empty and activation
fails closed; live worker and player subtitle delivery are still unfinished.

| Check                                 | Status                    | Evidence                                                                                                                                                                                                                      |
| ------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local CI                              | PASS                      | `npm run ci:local`; 147 first-party source files, maximum 494 lines, strict types, 14 tests, production builds and unconfigured HTTP boundaries                                                                               |
| Migration 0006                        | PASS                      | Applied to fresh disposable PostgreSQL 16, adds language/catalog versions and validation metadata without seeded languages                                                                                                    |
| Language administration HTTP          | PASS                      | `npm run test:languages:db`; verified Access plus matching session and same origin; canonical codes, input bounds, immutable provider roles and references                                                                    |
| Validation persistence                | PASS                      | Built HTTP requests through actual loopback WebSocket/HTTP fixtures; stable source and translated text produce a revision-bound proof that survives restart; quota failure records the attempt and preserves the last success |
| Stale evidence and concurrent editing | PASS                      | Two built processes race edits; provider and term revisions make old proof stale; replacing a path while its translation is held rejects the late sample with 409 and leaves the new path unvalidated                         |
| Ordering, default and pagination      | PASS                      | Atomic adjacent move, stale default rejection, persisted default and deletion cleanup; 53 languages exercise 50-entry pages and reject an obsolete page version; delete/recreate cannot reuse an old entry version            |
| Activation remains closed             | PASS                      | An unvalidated language returns PATH_UNVALIDATED; a successfully validated language returns DELIVERY_UNAVAILABLE; public languages remain empty                                                                               |
| Privacy and provider deletion         | PASS                      | Language responses and audit omit credentials, audio and transcript text; a referenced provider cannot be deleted, and deletion succeeds after references are removed                                                         |
| Database and related regressions      | PASS                      | `test:db` (seven tests), `test:http:db`, `test:ws:db`, `test:management:db`, `test:providers:db`, `test:samples:db`, `test:terms:db` on disposable PostgreSQL                                                                 |
| Readiness dependency check            | PASS                      | Removing the initialized language catalog row, then hiding the output-language validation column, each returns 503; restoring each dependency returns 200                                                                     |
| Browser language workflow             | PASS                      | Chrome with local signed identity: create canonicalized code and two paths, reorder, choose default, reload in another tab; stale save is refused and explicit reload shows the accepted name                                 |
| Responsive layout and shared form     | PASS                      | Language editor and saved-path sample form fit a 320 px viewport/document width; both sample forms have distinct IDs; literal angle brackets remain text; no captured browser errors/warnings                                 |
| Complete browser WAV upload/results   | NOT RUN                   | The existing Chrome file-URL permission limitation remains unresolved; sample form and HTTP upload/persistence were checked separately, without claiming a complete browser result                                            |
| Real provider access and quality      | NOT RUN                   | All provider responses/audio in these checks are synthetic fixtures; no real provider credentials or authorized battle speech supplied                                                                                        |
| Discord/audio/full acceptance         | WAITING FOR CONFIGURATION | Dedicated bot page verified; existing token cannot be viewed again. Saved token location and guild/channel/commander IDs remain pending. Media revocation, worker integration, player subtitles and PiP remain incomplete     |

The new suite owns persisted language behavior at the built HTTP boundary; existing
provider/sample suites own wire format and upload semantics. It introduces no
production test switch or fake activation path. No deployment was made.
`design.md` and `GOAL.md` remain byte-identical. Browser evidence is stored in
ignored local task artifacts. See [output languages](output-languages.md).

## Shared streaming subtitle processing — 2026-10-18 (historical)

The administrator sample now runs recognition and translation concurrently through
the shared source/language engine. This is executable processing used by the
application, but the Discord worker and authorized player-delivery boundary are
not yet connected to it. Production languages and providers remain disabled.

| Check                                                 | Status                    | Evidence                                                                                                                                                                                                         |
| ----------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local CI                                              | PASS                      | `npm run ci:local`; 131 first-party source files, largest 494 lines, strict types, 14 tests, builds and unconfigured HTTP boundaries                                                                             |
| Shared requests and independent languages             | PASS                      | Local protocol test: two Japanese subscribers plus one Korean subscriber use one recognition connection and two translations per language for two utterances                                                     |
| Audio input during slow translation                   | PASS                      | All 50 PCM frames and stream termination reach recognition while Japanese translation is held; Korean completes independently. This verifies provider input, not browser original-audio playback                 |
| Revisions, retraction and finality                    | PASS                      | Corrected text cancels the actual older HTTP request; withdrawn text clears immediately; an unchanged final transcript reuses its existing translation without an extra request                                  |
| Path replacement and source failure                   | PASS                      | Higher path version clears queued work and rejects late results without restarting recognition; a dropped recognition connection cancels its HTTP work and a fresh source receives only its own results          |
| New subscribers and release                           | PASS                      | A subscriber joining while a prior request is held receives no earlier result; the remaining subscriber continues; the last unsubscribe leads to physical recognition socket closure after the grace period      |
| Bounded translation queue                             | PASS                      | A held request followed by 40 synthetic utterances discards obsolete queued work, marks discontinuity and retains the newest 32; delayed work never overwrites a newer revision                                  |
| Configuration normalization regression                | PASS                      | Reordered keys in equivalent path settings first caused INVALID_CONFIGURATION; canonical validation now shares the same lane                                                                                     |
| Total cancellation regression                         | PASS                      | Cancelling after recognition had finished first left translation running; the owner deadline now aborts the actual held HTTP request and rejects with TIMEOUT                                                    |
| Built sample HTTP and persistence guards              | PASS                      | `npm run test:samples:db` on disposable PostgreSQL 16; upload bounds, PCM/pauses, source revisions, terminology and opt-out, failures, pair leases, stale provider/catalog rejection and safe audit remain valid |
| Related provider and catalog regressions              | PASS                      | `test:providers:db` and `test:terms:db` pass against built servers and fresh migrated PostgreSQL                                                                                                                 |
| Browser sample upload and result rendering            | NOT RUN                   | Previously blocked by the Chrome extension's lack of file-URL access. Stable/provisional translation labels were updated; no complete browser sample-result success is claimed                                   |
| Real provider access, speech quality and live latency | NOT RUN                   | Requests in these checks use loopback protocol fixtures with synthetic speech text and translations                                                                                                              |
| Discord original audio and core production acceptance | WAITING FOR CONFIGURATION | Bot token location and guild/channel/commander IDs remain pending; media, worker integration, player subtitles, PiP and network/game acceptance remain incomplete                                                |

No new deployment was made. Provider processing bounds are implementation guards,
not measured battle latency or supported-player capacity. The shared engine's
subscriber callbacks are server-internal; these tests do not replace player
WebSocket authorization or media-revocation tests. See [streaming subtitles](streaming-subtitles.md).

## Editable terminology and sample context — 2026-10-18 (historical)

Administrators can now create, edit, disable, delete and search versioned game
terms. Authorized sample comparisons can send enabled terms through Soniox and
DeepL's documented context fields, preserving the source and translated text as
returned. Context hints are not evidence that a provider used the intended term.
The catalog starts empty and no production provider or language is enabled.

| Check                                                  | Status                    | Evidence                                                                                                                                                                                                   |
| ------------------------------------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local CI                                               | PASS                      | `npm run ci:local`; 128 first-party source files, largest 494 lines, strict types, eight tests, web/migration/worker builds and unconfigured HTTP boundaries                                               |
| Migration 0005                                         | PASS                      | Applied to disposable PostgreSQL 16; adds term tables and the empty catalog revision without seeded vocabulary                                                                                             |
| Authenticated terminology HTTP                         | PASS                      | `npm run test:terms:db`; verified Access plus persisted session and same origin; invalid fields, control characters and oversized/chunked bodies rejected                                                  |
| Persistent terms and concurrent edits                  | PASS                      | Two built processes share one catalog; source/alias collisions, concurrent creation and stale updates reject; restart preserves entries; delete/recreate cannot reuse an obsolete version                  |
| Search and pagination                                  | PASS                      | 52 synthetic entries exercise 50-entry pages, literal percent-sign search and stale catalog-page rejection                                                                                                 |
| Provider context and output-language separation        | PASS                      | `npm run test:samples:db`; loopback Soniox receives source terms without target expressions; DeepL receives only the selected target expression; disabled terms and comparisons without terms are excluded |
| Sample revision and context limits                     | PASS                      | A catalog edit while translation is in flight rejects the old result with 409; excessive context rejects before provider requests; audits contain revisions without term, audio or transcript text         |
| Unknown-language validation regressions                | PASS                      | Tests first reproduced acceptance of `und` as a term/output language; shared validation now rejects it, including sample requests before provider work                                                     |
| Existing application regressions                       | PASS                      | `test:db` (seven tests), `test:http:db`, `test:ws:db`, `test:management:db` and `test:providers:db` on disposable PostgreSQL 16                                                                            |
| Browser terminology workflow                           | PASS                      | Chrome with local signed identity: create three output expressions, reload in another tab, edit and disable; an older tab's save is refused and explicit reload shows the accepted revision                |
| Literal text and narrow layout                         | PASS                      | Angle brackets render as text; populated term editor and all language fields fit a 320 px viewport with document width 320 px; captured console has no warning/error entries                               |
| Live recognition, translation and terminology accuracy | NOT RUN                   | No real provider credentials or authorized battle samples; synthetic responses do not establish quality, latency or provider suitability                                                                   |
| Discord reception and original audio                   | WAITING FOR CONFIGURATION | Dedicated bot exists; saved token location and guild/channel/commander IDs remain pending                                                                                                                  |
| Shared live subtitles, PiP and full acceptance         | NOT RUN                   | No deployment by this task; media and live subtitle integration remain incomplete                                                                                                                          |

Browser screenshots are retained under ignored local task artifacts. Vocabulary
and provider responses are explicitly synthetic test fixtures. These checks do
not constitute a complete accessibility audit or game compatibility assessment.
The source specification files remain byte-identical. See [game terminology](game-terms.md)
for the exact context-matching rules and processing bounds.

Readiness regression: **PASS** on a built server and disposable PostgreSQL.
Temporarily removing access to the terminology table, then to the initialized
catalog row, each returned 503; restoring each returned 200. Local CI and the
existing database-backed HTTP suite passed again after extending the probe.

## Recognition adapter and audio-sample comparison — 2026-10-18 (historical)

This stage adds Soniox recognition with token revisions and utterance endpoints,
plus an administrator-only authorized WAV comparison using saved Soniox and
DeepL candidates. It does not enable production providers/languages or player
subtitles. No live credential or authorized speech sample was supplied, and this
implementation task has not deployed these changes.

| Check                                                | Status                    | Evidence                                                                                                                                                                                                                            |
| ---------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local CI                                             | PASS                      | `npm run ci:local`; 115 first-party source files, largest 430 lines, strict types, eight tests, web/migration/worker builds and unconfigured HTTP boundaries                                                                        |
| Soniox wire format regression                        | PASS                      | The protocol test first failed with actual `s16le` versus documented `pcm_s16le`; the shared recognizer now sends the correct format and passes the same test                                                                       |
| Authorized sample HTTP and input limits              | PASS                      | `npm run test:samples:db`; signed Access plus persisted session and same origin; truncated/stereo/overlong WAV rejected before network use; JSON above 1,400,000 bytes returns 413                                                  |
| PCM timing and transcript revisions                  | PASS                      | A generated tone/paused sample reaches a real loopback WebSocket byte-for-byte, including silence; a protocol fixture revises “Attack” to “Do not attack,” finalizes two utterances, and known versus missing times remain distinct |
| Separate translation and safe outcomes               | PASS                      | Stable utterances produce one DeepL request each with the selected output script; no-speech makes no translation request; quota failures retain original text with a safe classification                                            |
| Pair leases, stale evidence and audit privacy        | PASS                      | Two built servers verify both configurations are locked during sample processing; replacing one after lease expiry makes the old result return 409; audits omit audio, text and credentials                                         |
| Existing regression checks                           | PASS                      | `test:db` (seven tests), `test:http:db`, `test:ws:db`, `test:management:db`, and `test:providers:db` against disposable PostgreSQL 16                                                                                               |
| Browser sample form and responsive layout            | PASS                      | Chrome: saved candidates selectable, output-language input editable, submission disabled without a file; viewport and document width both 320 px, no captured browser errors/warnings                                               |
| Browser file selection and complete sample UI result | NOT RUN                   | The Chrome extension lacks file-URL access; automated file selection was rejected before upload. The real HTTP upload/processing path passed separately; no browser-result success is claimed                                       |
| Live provider access, quality and latency            | NOT RUN                   | Local fixture text is deterministic test data. No actual Soniox/DeepL access or recognition/translation quality has been established                                                                                                |
| Discord source and original audio                    | WAITING FOR CONFIGURATION | Dedicated bot exists; token storage location and guild/channel/commander IDs remain pending                                                                                                                                         |
| Full design acceptance and release                   | NOT RUN                   | Shared live jobs, language administration, media revocation, player subtitles and PiP remain unfinished; no deployment                                                                                                              |

The sample HTTP test also first reproduced rejection of Soniox's documented
`translation_status: none` source tokens as `INVALID_RESPONSE`. The parser now
accepts both documented source-token statuses (`none` and `original`) while
rejecting translated tokens on this recognition-only stream.

No production test flags, alternate provider destinations or identity bypasses
were introduced. Browser screenshots are ignored local artifacts. The sample
does not store recordings or transcript text and does not overwrite a saved
configuration's connection-test result. `design.md` and `GOAL.md` remain identical.

## Provider candidates and configuration history — 2026-10-18 (historical)

Current branch additions include encrypted provider candidates, real connection
request implementations, configuration history, tested replacement/restore, and
an administrator editor. They have not been deployed. The full design.md goal
remains incomplete: Discord audio, media revocation, the complete subtitle path,
language administration and PiP still require implementation and live evidence.

| Check                                       | Status                    | Evidence                                                                                                                                                                                                                          |
| ------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local CI                                    | PASS                      | `npm run ci:local`; 106 first-party source files, largest 397 lines; strict types, eight tests, web/migration/worker builds and unconfigured HTTP boundaries                                                                      |
| Provider wire contracts                     | PASS                      | `npm test`; real loopback HTTP/WS fixtures verify DeepL method/auth/language scripts, response limits, errors, deadlines and redirect refusal; Soniox frames, silence duration, final acknowledgement and safe failures           |
| Provider management and PostgreSQL          | PASS                      | `npm run test:providers:db`; signed Access plus persisted session, same-origin guards, encrypted current/history values, failed candidate/restore preservation, referenced deletion refusal and no key/ciphertext in reads/audits |
| Concurrent tests and stale completion       | PASS                      | Two built Node servers share one lease; concurrent tests/mutations reject; an expired lease permits a newer save, and the older response cannot overwrite it                                                                      |
| Provider persistence and restoration        | PASS                      | New process reads accepted settings/history; restoring version 1 produces a newer version, failed restoration keeps the current one, and cross-configuration ciphertext is rejected                                               |
| Existing application regression checks      | PASS                      | `test:db` (seven tests), `test:http:db`, `test:ws:db`, and `test:management:db` on disposable PostgreSQL 16                                                                                                                       |
| Migration 0004                              | PASS                      | Applied additive provider history/lease columns; readiness and built management tests use the migrated database                                                                                                                   |
| Browser configuration workflow              | PASS                      | Chrome with local signed identity and local provider fixtures: create, test, invalid-key feedback without replacement, edit, restore as a new version, reload, and empty password field                                           |
| Narrow browser layout                       | PASS                      | Populated provider editor at 320 px has document width 320 px; fields and buttons remain visible                                                                                                                                  |
| Real provider access, quality and selection | NOT RUN                   | No provider credentials or authorized speech sample; local responses do not establish live access, translation quality, latency or provider suitability                                                                           |
| Discord reception and original audio        | WAITING FOR CONFIGURATION | Developer portal confirms the dedicated bot exists; token storage path and guild/channel/commander IDs remain pending                                                                                                             |
| Production release and full acceptance      | NOT RUN                   | No deployment by this implementation task; production languages/providers remain unavailable                                                                                                                                      |

Browser proof is retained in ignored local artifacts. Tests use generated/fake
credentials and disposable local services. Test-only routing preloads are absent
from production code; no alternate endpoint or identity bypass was added. DeepL
400 errors remain a safe rejected-settings category until specific live error
contracts are validated. Soniox's documented model error has its own category.

## Room administration and credential protection — 2026-10-18 (historical)

Current branch scope: persistent listeners and player sockets, plus versioned
room/Discord configuration, encrypted bot credentials and the administrator
listener list. These additions have not been deployed by this implementation
task. Discord audio, real subtitles, provider settings and PiP remain incomplete.

| Check                                                         | Status  | Evidence                                                                                                                                                                                          |
| ------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source checks and unconfigured boundaries                     | PASS    | `npm run ci:local`; 86 first-party source files, largest 386 lines; strict types, seven unit tests, web/migration/worker builds and built HTTP smoke                                              |
| Existing database, HTTP and socket contracts                  | PASS    | `npm run test:db` (seven tests), `npm run test:http:db` and `npm run test:ws:db` on disposable PostgreSQL 16                                                                                      |
| Authenticated management HTTP                                 | PASS    | `npm run test:management:db`; generated RS256 assertion plus persisted Better Auth cookie; no assertion, no cookie, forged assertion and foreign Origin rejected                                  |
| Empty-POST administrator sign-in regression                   | PASS    | The new built-Nitro test first reproduced HTTP 415; preserving the absent request body makes the unchanged bodyless POST return 200                                                               |
| Credential storage and failure handling                       | PASS    | Independent Node crypto decryption verifies AES-256-GCM storage; tag tampering, cross-room ciphertext, wrong key and missing key reject saves without advancing the version                       |
| Versioning, redaction and restart                             | PASS    | Concurrent same-version writes yield one 200 and one 409; reads/audits omit credentials; replacement gets a fresh nonce; stopped state, settings and administrator cookie survive process restart |
| Exact-generation administrator removal                        | PASS    | Signed administrator removes an actual WebSocket session; wrong generation returns 404, correct generation sends ADMINISTRATOR_REMOVED and closes the socket                                      |
| Migration 0003                                                | PASS    | Applied the additive room configuration migration and repeated `npm run db:migrate` successfully; readiness and all database-backed checks use the migrated schema                                |
| Administrator browser flow                                    | PASS    | Chrome on macOS with a local signed-identity fixture; save/reload persists settings, no credential is repopulated, stale second-tab edit is rejected, explicit reload recovers current version    |
| Browser removal and narrow layout                             | PASS    | Player receives the administrator-removal message and does not re-enter after refresh; populated admin form/list at 320px has document width 320px                                                |
| Real Access operator sign-in and Discord reception            | NOT RUN | Local keys and a test-only JWKS response do not validate live Access policy or Discord token permissions; token storage and guild/channel/commander inputs remain pending                         |
| Audio, subtitle/provider paths, PiP and production acceptance | NOT RUN | No new transport or provider is enabled; the full design.md objective remains incomplete                                                                                                          |

Browser screenshots are retained in ignored local task artifacts. Only a fake
local bot credential and local test IDs were used; the fake credential was removed
after verification. The browser fixture still goes through RSA verification and
the database-backed session; no production authentication bypass was added.
The source specification files remain byte-identical. Unconfirmed media shutdown
continues to show DISCONNECTING and never grants a replacement command access.

## Player WebSocket and browser sessions — 2026-10-18 (historical)

Scope of the preceding stage: persistent listeners plus real player sockets and the waiting-room
interface. With a migrated database, entry is available as JOINING. Original audio,
actual subtitle delivery and media revocation remain unavailable; no listener is
authorized for command delivery. The full design.md objective remains incomplete.

| Check                                                                                        | Status  | Evidence                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source limits, formatting, strict types, unit tests, builds and unconfigured HTTP boundaries | PASS    | `npm run ci:local`; 73 first-party source files, largest 318 lines; seven unit tests                                                                                              |
| Database coordinator and HTTP regressions                                                    | PASS    | `npm run test:db` (seven tests) and `npm run test:http:db` against disposable PostgreSQL 16                                                                                       |
| Real player WebSocket authorization                                                          | PASS    | `npm run test:ws:db`; foreign Origin rejected at upgrade, invalid credential receives no session/list, client subtitle publication closes the connection                          |
| Cross-process replacement and close confirmation                                             | PASS    | Same suite uses two built Node processes sharing PostgreSQL; replacement on B sends terminal state and closes A's socket; old credentials cannot register a live socket           |
| Heartbeat, recovery and graceful server shutdown                                             | PASS    | Real nonce/pong renews the database heartbeat; socket closure and graceful process shutdown leave no open registration; reconnection retains session/generation                   |
| Browser entry, refresh and public list                                                       | PASS    | Chrome on macOS; entry renders JOINING, nickname `<前排>验证-1018` is literal text, a fresh tab reads the existing list; refresh preserves the original session ID and generation |
| Browser replacement and obsolete-page refresh                                                | PASS    | Second tab takes generation 2; first tab displays the required replacement notice; refreshing it creates no third session or generation                                           |
| Browser recovery and pending leave                                                           | PASS    | Local server restart restores one socket on generation 2; a leave during outage survives refresh, ends generation 2 and opens no replacement socket                               |
| Narrow layout                                                                                | PASS    | Chrome viewport and document width both 320px; entry/listener controls and list remain readable; screenshots retained in local task artifacts                                     |
| Migration 0002                                                                               | PASS    | `npm run db:migrate` applied `player_connection` on PostgreSQL 16; schema used by the real socket and browser checks                                                              |
| Hard-crash registration recovery                                                             | NOT RUN | Unconfirmed sockets remain fail-closed; an operational method to prove owning transport shutdown and reconcile orphaned rows is still required                                    |
| Live Discord, original audio, actual subtitles, providers and PiP                            | NOT RUN | No live audio/provider credentials have been used and no media adapter is enabled; these results cannot establish sound shutdown or translation quality                           |
| Production/network/game-mode acceptance                                                      | NOT RUN | These implementation checks used loopback HTTP/WebSocket on macOS, not a player network or AION2                                                                                  |

The browser checks are functional checks, not a complete accessibility audit.
The list intentionally retains DISCONNECTING rows while media shutdown is
unconfirmed. No test fixture or enabled language is seeded into production.
The waiting-room WebSocket sends no battle commands or subtitle history.

The branch incorporates remote main's migration packaging at `09bbb8b`. A clean
`npm ci` followed by all four validation commands above passed after integration.
Gitleaks 8.30.1 scanned the full available Git history with redaction and reported
no leaks. The source specification files remain byte-identical.

## Persistent HTTP stage — 2026-10-18 (historical)

Scope of the preceding implementation stage: persistent listener lifecycle,
guarded HTTP operations and local PostgreSQL. At that stage browser entry was
disabled. The current waiting-room status and later checks are recorded above.

| Check                                                                                                  | Status  | Evidence                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source limits, formatting, strict types, unit tests, web/worker build and unconfigured HTTP boundaries | PASS    | `npm run ci:local`; 58 first-party source files, largest 260 lines; seven unit tests                                                                                                                    |
| Database-backed administrator and listener operations                                                  | PASS    | `npm run test:db`; seven tests total, including six listener scenarios using actual PostgreSQL 16                                                                                                       |
| Atomic cross-room replacement and concurrent entry                                                     | PASS    | Eight concurrent entries produce generations 1–8 with only generation 8 ACTIVE; NFC variants share the global nickname key                                                                              |
| Idempotency, obsolete retries, stale cleanup, and uncertain removal                                    | PASS    | Concurrent copies of one request return one session; old retries never replace the current one; A→B→C waits for A as well as B; partial acknowledgements keep JOINING/DISCONNECTING                     |
| Language subscription persistence and refusal                                                          | PASS    | Enabled local fixture selection preserves session/generation, increments subscription version; disabled code is refused; no transport revocation called                                                 |
| Built HTTP API with a real database                                                                    | PASS    | `npm run test:http:db`; origin and credential rejection, 202 JOINING, terminal replacement, replay conflict, public field allowlist, unauthorized management denial, process restart and explicit leave |
| Migration and populated-schema upgrade                                                                 | PASS    | `npm run db:migrate` repeated successfully; migration 0001 applied to an isolated 0000 schema containing one legacy session, preserving the row and initialized subscription version                    |
| Specifications kept identical                                                                          | PASS    | `cmp design.md GOAL.md`                                                                                                                                                                                 |
| Discord application lookup                                                                             | PASS    | User-supplied Developer Portal application `1561310594714304685` is named `babel-aion2`; bot page inspected in the authenticated browser                                                                |
| Live Discord reception and actual media/subtitle shutdown                                              | NOT RUN | The bot token cannot be viewed again in the portal; token storage location and guild/channel/commander IDs are pending. No transport adapter selected or enabled                                        |
| Browser refresh, replacement message, sound shutdown, and WebSocket delivery                           | NOT RUN | Server restore/terminal data is implemented; listening UI and WebSocket are not connected                                                                                                               |
| Provider configuration, subtitles, PiP, production deployment and actual network/game-mode acceptance  | NOT RUN | Remain required by the full design; no production changes in this implementation batch                                                                                                                  |

Transport acknowledgement fixtures are simulated. They prove coordinator ordering
and database state, not actual audio stop, old-token rejection or subtitle delivery.
The public lobby still advertises zero languages/providers and unavailable entry.
There is no claim that live Cloudflare policy or production media has passed.

At the end of that stage, the implementation was retained in the dedicated
Codex-managed `babel-implementation` worktree. The newly configured GitHub remote
had no integration branch yet. Remote main was created during the later WebSocket
stage; worktree cleanup still requires verified remote integration of task commits.

## Scaffold baseline

Date: 2026-10-18. Scope: scaffold validation and initial private release,
not full product delivery. Release source: `09bbb8bf88600df29edea0f0e63792aaa746129e`.

| Check                                                                 | Status  | Evidence                                                                                                                                               |
| --------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Original brief copied verbatim to both specification files            | PASS    | `cmp` confirmed design.md, GOAL.md, and the supplied attachment are identical                                                                          |
| Source line limits                                                    | PASS    | 41 first-party source files; largest is main.css at 228 lines; maximum 800                                                                             |
| Formatting and strict types                                           | PASS    | `npm run ci:local` completed; all workspace type checks and formatting passed                                                                          |
| Nickname validation and language selection                            | PASS    | Four tests cover NFC, case, control characters, code-point limit, preference order, and Chinese writing systems                                        |
| Signed Access identity, forged signature, issuer/audience/time checks | PASS    | Generated RS256 test keys; real signature checks with stubbed JWKS transport                                                                           |
| Same-origin checks and protected route classification                 | PASS    | Remaining auth tests in the seven-test unit suite passed                                                                                               |
| PostgreSQL migrations and repeated application                        | PASS    | Two successful migration runs against disposable local PostgreSQL 16; a later generation check found no schema drift                                   |
| Persistent Better Auth session across auth instances                  | PASS    | One database-backed test signed in, saved an HTTP-only cookie, restored its session through a new auth instance, and rejected a fabricated assertion   |
| Production web and worker builds                                      | PASS    | `npm run build` completed under Node 24.18.0; Nuxt 4.6.2 / Vue 3.5.44 / TypeScript 6.0.3                                                               |
| Built HTTP public/admin boundaries and unavailable entry              | PASS    | `npm run test:http`: public lobby 200, protected routes 401, forged identities 403, unavailable entry and database readiness 503                       |
| Browser rendering and narrow viewport                                 | PASS    | Codex in-app browser on macOS; dark lobby, editable nickname, disabled entry; 320px viewport and document width both 320px                             |
| Administrator navigation with missing configuration                   | PASS    | Full page navigation from the lobby reached /admin and displayed the protected 503 state                                                               |
| Container image build and non-root runtime                            | PASS    | Docker build succeeded; container UID 1000; lobby/live probe 200 and unconfigured admin/readiness 503                                                  |
| Private source and secret boundaries                                  | PASS    | Private GitHub repository created; complete application history scanned without detected credentials; production settings are in private infra         |
| Private release pipeline and image publication                        | PASS    | Self-hosted workflow passed local-equivalent checks, real database tests, bundled migration, and container probes before publishing a unique image tag |
| Read-only container and database readiness                            | PASS    | Local non-root container with read-only root filesystem, dropped capabilities, and a real migrated PostgreSQL database returned readiness 200          |
| Actual Cloudflare policy, proxy, and origin arrangement               | PASS    | HTTPS lobby, ten frontend assets and readiness 200; protected pages/APIs redirect to Access; origin rejects absent and forged identities               |
| Production migration and web rollout                                  | PASS    | ArgoCD migration hook Succeeded; application Synced / Healthy; two ready replicas match the published registry digest                                  |
| Production browser and signing key access                             | PASS    | In-app browser rendered the dark lobby and reached the real Access sign-in form; application retrieved signing keys with HTTP 200                      |
| Authenticated administrator browser session                           | NOT RUN | Requires a real authorized human Access sign-in; database session behavior is covered separately                                                       |
| Discord DAVE audio, media delivery, revocation and concurrency        | NOT RUN | Transport and entry lifecycle not implemented                                                                                                          |
| Provider management, credentials, languages and live quality          | NOT RUN | Adapters and settings UI not implemented; enabled language list is empty                                                                               |
| Background audio, Document PiP and AION2 display mode                 | NOT RUN | Requires implemented transport and a real player device                                                                                                |
| Production backup/restore rehearsal and rollback                      | NOT RUN | Initial scaffold release; no production restore rehearsal or previous Babel release to restore                                                         |

The automated result is seven unit tests, one real-database integration test,
and a separate built-server HTTP smoke suite, with no skipped tests. Tests use
generated keys and local-only language fixtures. A local JWT test does not
establish Cloudflare's live policy. A database-backed auth test does not establish
listener revocation. Browser checks are not a complete accessibility audit;
200% zoom and the authenticated management UI were not tested in a live Access session.

## Dependency audit

`npm audit` reports **18 dependency-graph advisories: 14 high, 4 moderate**.
The remaining root packages are:

- `braces` 3.0.3: nested-pattern stack exhaustion, reached through glob/watch tooling.
- `node-forge` 1.4.0: RSA verification advisory, reached through development TLS tooling.
- An older transitive `esbuild` used by Drizzle's loader: development-server origin checks.

These remain unresolved in the package graph. The scanned final
`.output/server/node_modules` tree contains none of those three packages; the
build/development dependency graph still carries the advisories. The directly
pinned Vue version was updated to 3.5.44. No forced downgrade of Nuxt or Drizzle
was applied. This is not a claim that the entire dependency graph is vulnerability-free.

## External inputs for later live checks

- Discord bot/guild/channel/commander configuration and permission to run a live audio test.
- A selected, revocation-tested media service and its approved server credentials.
- Selected provider credentials and authorized battle-command samples for subtitle quality tests.
- Real supported browser, AION2 display mode, and player network access for end-to-end checks.

These inputs are not blockers for the requested scaffold. Production language
selection remains reserved until validated processing paths exist.

## Git and task cleanup

The project started as an empty directory and was initialized as a Git repository.
Application files were authored and validated in the Codex-managed
`babel-scaffold` worktree and published to the private `portwatcher/babel-aion2`
repository. After task commits are verified on the latest `origin/main`, the
task worktree can be archived through Codex. Other active task worktrees must
be preserved. Infrastructure changes use the existing infra checkout explicitly
selected by the owner; no separate infra repository was created.

The active `babel-implementation` worktree contains the subsequent listener and
room-administration work. Its branch incorporates the release documentation from
`origin/main` at `528ac38`; these task commits remain unmerged and the worktree is
preserved. This implementation task has not changed production infrastructure.

Temporary preview and container processes are stopped at completion. Local task
records and the accessible chat list were checked for missing working directories;
no confirmed missing local directory was found. Remote-host path existence was
not independently verified by a remote filesystem probe.
