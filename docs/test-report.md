# Scaffold validation

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

Temporary preview and container processes are stopped at completion. Local task
records and the accessible chat list were checked for missing working directories;
no confirmed missing local directory was found. Remote-host path existence was
not independently verified by a remote filesystem probe.
