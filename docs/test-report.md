# Validation

## Player WebSocket and browser sessions — 2026-10-18

Current scope: persistent listeners plus real player sockets and the waiting-room
interface. With a migrated database, entry is available as JOINING. Original audio,
actual subtitle delivery and media revocation remain unavailable; no listener is
authorized for command delivery. The full design.md objective remains incomplete.

| Check                                                                                        | Status  | Evidence                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source limits, formatting, strict types, unit tests, builds and unconfigured HTTP boundaries | PASS    | `npm run ci:local`; 72 first-party source files, largest 318 lines; seven unit tests                                                                                              |
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

Date: 2026-10-18. Scope: local scaffold only, not full product delivery.

| Check                                                                 | Status                    | Evidence                                                                                                                                             |
| --------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original brief copied verbatim to both specification files            | PASS                      | `cmp` confirmed design.md, GOAL.md, and the supplied attachment are identical                                                                        |
| Source line limits                                                    | PASS                      | 40 first-party source files; largest is main.css at 228 lines; maximum 800                                                                           |
| Formatting and strict types                                           | PASS                      | `npm run ci:local` completed; all workspace type checks and formatting passed                                                                        |
| Nickname validation and language selection                            | PASS                      | Four tests cover NFC, case, control characters, code-point limit, preference order, and Chinese writing systems                                      |
| Signed Access identity, forged signature, issuer/audience/time checks | PASS                      | Generated RS256 test keys; real signature checks with stubbed JWKS transport                                                                         |
| Same-origin checks and protected route classification                 | PASS                      | Remaining auth tests in the seven-test unit suite passed                                                                                             |
| PostgreSQL migrations and repeated application                        | PASS                      | Two successful migration runs against disposable local PostgreSQL 16; a later generation check found no schema drift                                 |
| Persistent Better Auth session across auth instances                  | PASS                      | One database-backed test signed in, saved an HTTP-only cookie, restored its session through a new auth instance, and rejected a fabricated assertion |
| Production web and worker builds                                      | PASS                      | `npm run build` completed under Node 24.18.0; Nuxt 4.6.2 / Vue 3.5.44 / TypeScript 6.0.3                                                             |
| Built HTTP public/admin boundaries and unavailable entry              | PASS                      | `npm run test:http`: public lobby 200, protected routes 401, forged identities 403, unavailable entry and database readiness 503                     |
| Browser rendering and narrow viewport                                 | PASS                      | Codex in-app browser on macOS; dark lobby, editable nickname, disabled entry; 320px viewport and document width both 320px                           |
| Administrator navigation with missing configuration                   | PASS                      | Full page navigation from the lobby reached /admin and displayed the protected 503 state                                                             |
| Container image build and non-root runtime                            | PASS                      | Docker build succeeded; container UID 1000; lobby/live probe 200 and unconfigured admin/readiness 503                                                |
| Actual Cloudflare policy, proxy, and origin arrangement               | WAITING FOR CONFIGURATION | No Babel Access application was provisioned                                                                                                          |
| Discord DAVE audio, media delivery, revocation and concurrency        | NOT RUN                   | Transport and entry lifecycle not implemented                                                                                                        |
| Provider management, credentials, languages and live quality          | NOT RUN                   | Adapters and settings UI not implemented; enabled language list is empty                                                                             |
| Background audio, Document PiP and AION2 display mode                 | NOT RUN                   | Requires implemented transport and a real player device                                                                                              |
| Production deployment, backup/restore and rollback                    | NOT RUN                   | No production changes or release                                                                                                                     |

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

- Repository/registry release configuration and the approved infra deployment path.
- A Babel Access application audience and secret-store entries for administrator sessions.
- Discord bot/guild/channel/commander configuration and permission to run a live audio test.
- A selected, revocation-tested media service and its approved server credentials.
- Selected provider credentials and authorized battle-command samples for subtitle quality tests.
- Real supported browser, AION2 display mode, and player network access for end-to-end checks.

These inputs are not blockers for the requested scaffold. Production language
selection remains reserved for configuration after deployment.

## Git and task cleanup

The project started as an empty directory and was initialized as a Git repository.
Application files were authored and validated in the Codex-managed
`babel-scaffold` worktree. There is no configured remote, so remote integration
cannot be verified and the managed worktree must be retained under AGENTS.md.
Local integration into the primary checkout is recorded in Git history.

Temporary preview and container processes are stopped at completion. Local task
records and the accessible chat list were checked for missing working directories;
no confirmed missing local directory was found. Remote-host path existence was
not independently verified by a remote filesystem probe.
