# Validation

## Current acceptance status — 2026-10-19

The complete `design.md` delivery is unfinished. Production runs web, voice and
the private recovery controller from source
`e5a7499ed7558e5d8ed34590053c0806b2480ccd`. The latest rollout preserves the
configured room and existing listener while adding confirmed Pod retirement.
The dated reports below retain the conditions of each run. A local or isolated
PASS applies only to that named check, not automatically to production.

| Acceptance area                              | Result                    | Evidence and remaining dependency                                                                                                                                                                                    |
| -------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web release and access boundaries            | PASS                      | Two production web replicas and 13 migrations are ready; public browser/assets and direct-origin rejection checks passed in the earlier release and protected management remains accessible after the latest rollout |
| Local listener, media and subtitle contracts | PASS                      | Built application suites cover nickname replacement, actual peer closure, per-member PCM, shared subtitle transport and child-process recovery; live provider responses are not part of these proofs                 |
| Production voice infrastructure              | PASS                      | One ready worker, authenticated private control, configured pool budgets, actual pod/public TURN forwarding and normal Chrome media connection/exit passed; see the current deployment report                        |
| Production Discord configuration             | PASS                      | Human Access login, normal encrypted-credential save and separate start succeeded. ALL_CHANNEL reports LISTENING with no failure reason; a real browser listener connected while the source was live                 |
| Production single-member receipt             | PASS                      | After the human joined the configured voice channel, the actual worker reported the correct member identity and 282 decoded frames at 02:03 UTC, generation 9, with no failure reason                                |
| Production session and PiP lifecycle         | PASS                      | Real Chrome replacement, same-session refresh, playback action, administrator removal and PiP closure passed against deployed replicas; independent persisted transport receipts confirm closure                     |
| Graceful production worker replacement       | PASS                      | Settings and listener generation survived GitOps replacement. A cross-node TURN routing regression was reproduced and corrected; the browser reconnected and the new source decoded another 29 frames                |
| Production snapshot restoration              | PASS                      | A read-only production snapshot restored all 19 application/migration tables, schema, sequences and one encrypted Discord credential into isolated local PostgreSQL; the exact published web image passed readiness  |
| Isolated whole-container recovery            | PASS                      | Real Kubernetes SIGKILL closes scoped web/media records, unblocks nickname replacement and preserves a surviving web connection; synthetic unknown status stays blocked while another Pod can retire                 |
| Production recovery deployment               | PASS                      | Healthy private controller, scoped permissions, Pod-bound runtime owners and finalizers are deployed. Settings and listener generation survive; Discord reconnects automatically after about two minutes of retries  |
| Single-member audible playback               | PASS                      | After the relay correction and browser reconnection, the human confirmed hearing their own Discord voice through the production Babel webpage                                                                        |
| Multiple-member behavior                     | NOT RUN                   | Simultaneous speakers, production source separation and production member leave/re-entry remain outstanding                                                                                                          |
| Live subtitle quality                        | WAITING FOR CONFIGURATION | Soniox/DeepL settings and validation are implemented. Authorized credentials and representative commands are needed to validate each chosen output language                                                          |
| Native window and game use                   | NOT RUN                   | Real Chrome subtitle-window opening and replacement-driven closure passed with subtitles disabled. Native desktop inspection failed; background audible playback and actual AION2 display mode remain unverified     |
| Deployed latency and capacity                | NOT RUN                   | Production transport now connects, but actual source/playback timing, load and player networks including mainland China remain unmeasured; connection success is not end-to-end latency evidence                     |
| Production disaster recovery                 | NOT RUN                   | Production-snapshot restoration and isolated published-image rollback passed. Durable backup retention, old-service fencing, production failover and live deployment rollback remain outstanding                     |

Empty production provider and language lists are intentional and do not block
the web release or original-audio deployment. Optional character enrichment is
disabled under the source policy recorded below; nickname entry remains available.

Latest source checks: `npm run ci:local` is PASS with 229 first-party sources,
maximum 495 lines, formatting, strict types, 18 tests, builds and built HTTP
smoke. `test:db` passes 11 real PostgreSQL tests, and both child-process recovery
checks pass. `design.md` and `GOAL.md` remain identical.

## Production recovery-controller rollout — 2026-10-19

The private self-hosted Linux AMD64 release of source `e5a7499` passed the same
18-test CI suite, 11 PostgreSQL tests, repeatable migrations and both packaged
runtime probes before publication. GitOps then applied migration 0012 and the
controller before rolling managed web and voice Pods. All four Pods were ready
with zero restarts; the running image digests matched publication and ArgoCD was
Synced / Healthy. See [current deployment](deployment.md#current-web-and-voice-verification--2026-10-19).

At 04:09 UTC, the database had 13 migrations and three active runtime owners,
each bound to its actual immutable Pod UID. Both web Pods and the voice Pod had
the required finalizer and no Kubernetes token; only the controller mounted its
scoped token. Controller liveness and readiness returned 200. Authorization
checks allowed namespace Pod list/delete and rejected Secret reads, cluster-wide
Pod listing and `patch pods --subresource=status`. Ten sampled database
connections were below the configured role limit; this is not a capacity test.

A digest covering stored room settings and the encrypted Discord credential was
unchanged. The same listener session and nickname generation remained ACTIVE,
with one player socket and one media connection. Chrome reconnected without a
manual refresh or new entry, and the authenticated management page displayed the
connected source. No provider or output language was enabled.

The source retried with the generic DISCORD reason during the rollout. The old
source closed at 04:02:13 UTC; the successful new source was claimed at 04:04:03
and observed LISTENING at 04:06 and 04:09, generation 22. No room settings,
permissions or network changes were needed. The underlying transient failure was
not diagnosed; the outage must not be described as uninterrupted audio. No new
speech was supplied during this rollout check. The earlier human-confirmed
audible playback remains a separate result. Production abrupt container loss
and independent fencing of an unknown host were not tested by this rollout.

## Kubernetes container-loss recovery — 2026-10-19

The pre-fix built application reproduced a real failure in isolated Kubernetes:
SIGKILL stopped the actual web socket (1006), and session identity survived, but
the old owner/transport remained unconfirmed. Unrelated admission was ACTIVE;
same-nickname replacement remained JOINING. The existing surviving-parent tests
could not exercise this whole-container failure.

The repair binds supervised runtimes to immutable Pod identity and supplies a
private controller with durable admission barriers and scoped, independently
verified kubelet termination receipts. See [Kubernetes recovery](kubernetes-recovery.md).

| Check                                           | Result  | Evidence                                                                                                                                                                                                                          |
| ----------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Controller unavailable                          | PASS    | After real container SIGKILL, a restarted supervisor starts no replacement child and commits retirement intent. Same-nickname entry waits; unrelated admission remains available                                                  |
| Web container recovery                          | PASS    | Restoring the controller persists actual terminal-container evidence, closes only that Pod's socket/owner, and makes replacement ACTIVE. A second replica's actual connection remains open                                        |
| Unknown state and independent progress          | PASS    | With the worker kubelet suspended, an explicitly simulated Failed/137/ContainerStatusUnknown status retains its real responding WebSocket and unknown owner. Another never-started Pod seals admission and releases its finalizer |
| Worker container recovery                       | PASS    | The normal media API allocates a real peer with ICE candidates. SIGKILL stops the worker container; verified Pod evidence closes its media/owner records, and the same session/generation obtains a fresh offer after replacement |
| Storage and earlier recovery                    | PASS    | Eleven PostgreSQL tests include Pod admission/idempotency/late reservation and unchanged owner-lock fencing. Both real child-process web and ICE/DTLS worker recovery suites pass                                                 |
| Isolation and cleanup                           | PASS    | Only labelled, generated-data fixtures are affected. Exact container ID/Pod UID is checked before SIGKILL. Kubelet resumes and the test namespace and forwarding processes are removed                                            |
| Production abrupt loss and unknown host fencing | NOT RUN | This local proof does not establish production host loss, permanent node fencing or live Discord speech during an abrupt production failure                                                                                       |

The local cluster runs Kubernetes 1.32.0/containerd 1.7.24 on Linux ARM64; the
production cluster is Kubernetes 1.34.1/Linux AMD64. The guard was checked against
the deployed-version Kubernetes termination conversion contract. The negative
control exposed nullable unknown timestamps; parsing now retains that uncertainty
without blocking recovery of unrelated Pods. Test transport uses a loopback-only
NodePort so suspending kubelet does not itself cut the test socket. Startup and
replacement wait for the actual Service route, not merely a ready Pod. No Discord
credentials, live speech, providers or production data are used by this test.

## Production voice rollout — 2026-10-19

The later session and controlled-restart checks below extend this initial rollout
evidence. The human subsequently confirmed single-member audible playback after
the relay correction. Abrupt host-loss recovery remains unverified.

PASS: [initial web and voice deployment](deployment.md#initial-web-and-voice-verification--2026-10-19)
records the published/running image digests, healthy two-web/one-worker rollout,
authenticated and unauthorized control results, public responses/assets, and
successful relay-only browser entry/exit. The real worker exchanged ten packets
in each direction with an external TURN allocation. The one real browser test
session is REMOVED and both transport types have persistent closure receipts;
no synthetic player, provider, language or subtitle was seeded.

The release first exposed a missing ephemeral encryption key in its disposable
image test, then a Buildx lifecycle conflict. Private infra fixed both before
publication. The production probe exposed the host-network TURN identity rule;
its narrow policy correction was verified with actual traffic. Configuration,
secret values, addresses and operational release automation remain in infra.

PASS: authenticated human administrator setup subsequently saved the existing
authorized Discord source in ALL_CHANNEL mode and started it. At 01:59 UTC the
private control response was LISTENING, source generation 9, no failure reason
and no observed speakers. The form retains the encrypted credential without
returning it; a new normal browser listener established its audio connection.
The first start temporarily retried and the next start connected without code,
permission or network changes; the initial failure cause was not established.

PASS: one real member's audio reached the production worker after the human
joined the configured Discord channel. At 02:03 UTC the source still reported
LISTENING, generation 9, no failure reason, the correct member identity and 282
decoded frames. The first human attempt had no audible output while that account
was outside the voice channel. Audible playback was unconfirmed at that stage;
the later recovery report records the subsequent human confirmation. No voice
recording was retained.

NOT RUN: multiple-member behavior, provider quality, restricted/TLS relay paths,
mainland-China latency, capacity, native game behavior and disaster recovery.

## Production sessions and graceful worker recovery — 2026-10-19

These checks use normal production Chrome forms and the authenticated management
page. Database observations are read-only; no admission state, closure receipt or
player was seeded. Only the named verification listener was replaced or removed.

| Check                              | Result          | Evidence                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nickname replacement               | PASS            | Generation 1 becomes REPLACED and the old page shows the specified notice. Its actual socket/media closure timestamps precede generation 2's first media admission. Reloading the old page does not re-enter                                                                                      |
| Current-session refresh            | PASS            | Generation 2 and its session ID survive refresh, with one open socket and one media connection. The browser requests a playback action; clicking the visible button clears the blocked-playback state                                                                                             |
| Administrator removal and re-entry | PASS            | Normal confirmation ends generation 2 with ADMINISTRATOR_REMOVED. The page returns to entry, the online list reaches zero and all transport receipts close. Explicit re-entry creates generation 3                                                                                                |
| Real subtitle window               | PASS            | Chrome opens a separate document showing the actual disabled-subtitle state. Session/socket/media records remain unchanged. Replacement closes the window, confirmed by the browser's window inventory and old-page state                                                                         |
| Persistent settings and ownership  | PASS            | Two normal GitOps worker replacements log child exit code 0 and persist exited-owner/source/media closure. A digest including the encrypted room credential is unchanged. Each new source starts after the prior owner exits                                                                      |
| Cross-node relay regression        | FAIL, then PASS | The first replacement lands on another node: Discord reconnects, but public-node TURN TCP allocation times out after 5 seconds and Chrome repeatedly renegotiates. The same pod reaches the existing internal Service, exchanging ten packets each way with an external public allocation         |
| Deployed correction and recovery   | PASS            | Private infra switches only the worker TURN destination to the existing Service and rolls the worker. The deployed relay probe passes ten packets each way. Chrome reconnects without a new listener or manual refresh; source generation 11 reports the correct member and 29 new decoded frames |
| Single-member audible playback     | PASS            | After recovery, the human confirmed hearing their own Discord voice through the production Babel webpage. This is a human listening result in addition to the transport and decoded-frame observations                                                                                            |

The final worker is healthy and the generation-3 listener remained connected for
the successful human listening check. Extra test pages and the PiP window are closed. The two web
replicas retain their process owners. No shared TURN service, key, public endpoint,
port or network permission was expanded. The final running image is unchanged;
the correction is private infrastructure configuration.

The single-member listening result does not establish simultaneous members,
live translated subtitles, background sound, AION2 fullscreen behavior, capacity,
or recovery after abrupt supervisor/container/host loss. Native desktop window
inspection failed, while browser access to the actual PiP document succeeded.

## Production snapshot restoration — 2026-10-19

PASS: private infra now provides a reusable rehearsal that reads the actual
production database through the existing application role. A read-only exported
PostgreSQL snapshot supplies both the custom-format dump and independent table
digests. The production database and room settings are not modified.

The rehearsal restores the encrypted archive into a new local PostgreSQL
container using the production database image, encoding and locale. Restore uses
a generated non-superuser role; no production database URL is accepted as a
restore destination. The published web image runs as UID 1000 with a read-only
filesystem on an internal Docker network, without published ports or a voice
worker. It never attempts a Discord connection.

| Check                         | Result | Evidence                                                                                                                                                                                                                          |
| ----------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consistent data and schema    | PASS   | All 19 application/migration tables, columns, constraints, indexes and sequence values match the exported snapshot; migration history contains 12 entries                                                                         |
| Encryption and settings       | PASS   | The custom-format archive survives AES-256-GCM encryption/decryption. Room version 5, ALL_CHANNEL and running state survive; the existing protected key decrypts the one saved Discord credential and a different key is rejected |
| Published runtime             | PASS   | Repeating its migrations changes no snapshot data. Lobby, liveness, readiness and player configuration return 200; unauthenticated management returns 401                                                                         |
| Unconfirmed transport records | PASS   | The restored three open process owners and one open socket/media/source receipt each remain unconfirmed after web startup. The new web owner shuts down cleanly; restoration supplies no invented close receipt                   |
| Isolation and cleanup         | PASS   | No ports are published, no voice worker is started, and only labelled rehearsal resources are removed. Temporary databases, encrypted archive, registry credentials and newly pulled image references are removed                 |
| Production continuity         | PASS   | Subsequent inspection shows unchanged room settings, the same healthy web/voice pods with zero restarts, and Discord still LISTENING at source generation 11                                                                      |

An earlier digest comparison differed only in migration-row ordering between
database platform variants. Production locale order was 10, 11, 12, 1, 2…;
byte order was 1, 10, 11, 12, 2…. The rehearsal uses explicit byte ordering for
digests and the production database image/locale for restoration. No missing
production rows or schema difference was found.

This proof uses the real stored data and current published release, extending
the earlier generated-fixture restore check. It does not establish durable backup
retention, restoration of production roles/grants, live failover, reconciliation
of later revocations, or fencing after abrupt host loss. The temporary backup key
is discarded; this rehearsal does not retain a usable disaster-recovery backup.
Provider/language tables are currently empty, so live provider recovery and
translation quality are not exercised. See [operations](operations.md#backup-and-restore-procedure).

## Optional character source probe — 2026-10-19

The public [homepage](https://aion2index.com/) returned HTTP 200 and
`text/html; charset=utf-8` to an identified Babel compatibility request. Its
actual HTML contains a GET search form with action `/search`, field `q`, and a
`region` field. Public profile links use paths such as `/c/as/israphel/kbbb`,
and the homepage and [about page](https://aion2index.com/about) identify the
dataset as AION 2 Global with Asia among its regions.

The source's [robots.txt](https://aion2index.com/robots.txt) returned HTTP 200
and disallows `/search` and `/api/` for all crawlers. Automated nickname lookup
was therefore stopped before sending a search request. Its result is **NOT RUN
(source access policy)**, not a successful query with no matches or an HTTP 403.
No character ID or server match is asserted. Enrichment needs a permitted data
path before implementation can be enabled; it must not affect nickname admission.

## Published-image rollback compatibility — 2026-10-19

The new `test:rollback:images` command exercises the actual published Linux AMD64
images for source `09bbb8bf88600df29edea0f0e63792aaa746129e` and
`bbe9fc204d61b37a46284581416504bc172cb46e`. Their immutable digests match the
two production release records. The check ran locally with CPU emulation and a
disposable PostgreSQL 13.23 container; no production version or data was changed.

| Check                                         | Result  | Evidence                                                                                                                                                                                                                                                    |
| --------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Published runtime and migration compatibility | PASS    | Each image's own migration runner and default web entry run under UID 1000, read-only, with capabilities dropped. Database ownership belongs to a role without superuser, database-creation or role-creation privileges                                     |
| Upgrade, rollback and forward recovery        | PASS    | Migration count advances from 1 to 12. Running the older migration runner on the upgraded database preserves all 12 records; returning to the current runner applies no duplicate migrations. All four web starts reach readiness and shut down with exit 0 |
| Stored configuration                          | PASS    | Independent digests for 18 business/migration tables match across rollback. Process-owner rows are excluded because each process legitimately creates its own incarnation; all current owners close on normal exit                                          |
| Restored application settings                 | PASS    | Current-image HTTP reads retain the configured room, terminology, empty provider/language lists and stopped state. A normal save retains the encrypted bot credential after forward recovery                                                                |
| Administrator access                          | PASS    | The original test administrator cookie remains valid with the verified test Access identity across both images. Missing cookie, missing assertion and forged assertion remain denied                                                                        |
| Live deployment rollback                      | NOT RUN | No production GitOps image change, active listener/media rollback or provider request was performed. The previous scaffold omits current features; operators must stop command delivery before considering that downgrade                                   |

The first run stopped with HTTP 415 because the older sign-in endpoint requires
JSON. The shared fixture now sends an explicit empty JSON object, preserving the
normal authentication route. Database digests are shared with the existing
backup/restore test instead of duplicating its storage comparison. No production
endpoint, authentication flag or image modification was introduced. See
[the rollback procedure](operations.md#release-rollback) for command inputs and
the remaining production checks.

Final `npm run ci:local` is PASS: 217 first-party source files, maximum 495 lines,
formatting, strict types, 18 tests, builds and built HTTP smoke. The management
and PostgreSQL backup/restore regressions also pass after the shared fixture
changes. Test/support changes total +404/-22 lines; tooling adds one command.
All rollback containers, temporary databases, registry credential directories and
images downloaded for this exercise were removed. The authorized Discord preview
remains active for its separate live speech check.

## Production web release — 2026-10-19

PR #1 merged as `bbe9fc204d61b37a46284581416504bc172cb46e`. The existing
private release workflow (run 39161245803) published this exact source and updated
only the web Deployment and migration Job image references. After a targeted
repository-cache refresh, ArgoCD observed the new Git revision and performed the
migration and rollout.

| Check                            | Result                    | Evidence                                                                                                                                                                                                                                               |
| -------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Release pipeline                 | PASS                      | Linux AMD64 self-hosted run: local-equivalent CI, 18 tests, ten real PostgreSQL tests, repeated migrations and non-root image smoke; publication and job cleanup succeed                                                                               |
| Production migration and rollout | PASS                      | Migration hook Succeeded; 12 applied migrations. ArgoCD Synced / Healthy; two new ready replicas, zero restarts, and both image digests match publication                                                                                              |
| Public application               | PASS                      | Lobby, player configuration, liveness, readiness and 19 frontend assets return 200. Real Chrome renders the updated lobby without console errors                                                                                                       |
| Administrator boundaries         | PASS                      | Public administrator page, nested page, management API and auth API redirect to Access. Direct origin requests without assertions, with email only or cookie only return 401; a forged assertion returns 403. Runtime Access key retrieval returns 200 |
| Sensitive configuration          | PASS                      | A check inside the running pod compares five configured sensitive values against the HTML, public configuration and 19 assets: zero matches. Values never leave that process in the report                                                             |
| Configuration and ownership      | PASS                      | Both web runtime owners are registered. No production listeners, provider configurations or languages were seeded. Nickname entry is available; the source remains UNCONFIGURED and languages remain empty                                             |
| Live production commands         | WAITING FOR CONFIGURATION | Voice worker, private control routing, public TURN, pool budgets, real provider configuration and live Discord-to-browser speech remain outstanding                                                                                                    |
| Operational acceptance           | NOT RUN                   | Authenticated human administrator use, capacity, supervisor/host-loss recovery, production restore and release rollback are not established by this release                                                                                            |

The default Python HTTP user agent received Cloudflare 1010. The real Chrome
check and HTTP probes with a browser user agent passed; no Cloudflare policy was
changed. These are web deployment and access-boundary checks, not proof of audio,
subtitles, game-window behavior or production disaster recovery.
See [deployment details](deployment.md) for the immutable source and digest.

## Actual PostgreSQL backup restoration — 2026-10-19

The restore rehearsal uses real `pg_dump -Fc` and `pg_restore` with matching
server/tool major versions. Every source and destination is a disposable local
database. Provider responses, audio and credentials are synthetic fixtures; no
production data or live provider service is involved.

| Check                                 | Result  | Evidence                                                                                                                                                                                                                                                           |
| ------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL 13 and 16                  | PASS    | `test:restore:db` passes on both server majors. Each run dumps a live state and a normally stopped state, then restores each into a separate empty database                                                                                                        |
| Consistent full storage copy          | PASS    | A shared exported PostgreSQL snapshot supplies the dump and independent per-table digests. All 19 public/migration tables match exactly after restore; rerunning migrations preserves those digests                                                                |
| Restored application                  | PASS    | Actual web/worker processes reach readiness and reproduce room/provider/history/terminology/language-validation reads. The previous administrator cookie remains usable with verified Access, and cookie-only access is denied                                     |
| Credential recovery and stopped state | PASS    | A stopped room stays STOPPED. Retaining room/provider credentials succeeds with the original protected key; a wrong key cannot save the retained room credential or alter its version                                                                              |
| Ended listener                        | PASS    | A listener that left before the stopped-state dump remains denied with HTTP 410 after restoration. A fresh entry reuses the nickname with a higher generation                                                                                                      |
| Running-state snapshot                | PASS    | An actually open socket is captured in the live dump. After restoration, its receipt remains unconfirmed and duplicate-nickname entry remains JOINING. An unrelated nickname becomes ACTIVE, proving the block is scoped rather than general worker unavailability |
| Production disaster recovery          | NOT RUN | Production backup storage/encryption, later revocation history, old-service fencing, orchestration receipts and release rollback remain separate gates                                                                                                             |

Local CI is PASS: `npm run ci:local` checked 214 first-party sources, maximum
495 lines, formatting, strict types, 18 tests, builds and built HTTP smoke.
The separate PostgreSQL 13 regression is PASS: ten database cases and both actual
worker/web process crash-recovery cases. This rehearsal uses the disposable
database owner; production ownership and role grants were not restored or tested.

The first fixture run used a nonexistent provider-detail GET route and stopped
with 404. The fixture now reads the supported provider-list API; no production
route was added. Terminal-state inspection uses the application's REMOVED state
and the actual socket close event before making the stopped-state backup.
The test owns dump/restore integrity and application behavior after restoration;
existing suites retain provider protocol, cryptographic corruption and transport
revocation ownership. No production test endpoint or fake close receipt was added.
Temporary databases, mode-0600 dumps, the PostgreSQL 13 container and its newly
pulled image were removed. The separate live Discord fixture remains active.
Production/tooling adds one command line; tests and test support total +508/-11
lines. Application runtime behavior is unchanged by this rehearsal.

## Database connection budgeting — 2026-10-19

Web and voice runtimes now honor explicit per-pool limits. Each supervisor uses
one connection; the worker retains independent media, source-control and subtitle
pools. Invalid settings fail configured production startup. Default runtime pool
sizes remain 10, so operators must account for replicas, rolling updates and
maintenance connections before deployment. See [operations](operations.md#database-connection-budget).

| Check                                 | Result         | Evidence                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline regression                   | FAIL, expected | With both configured limits set to 2, the old build opened 11 web and 22 worker PostgreSQL sessions while requests were blocked on real tables. It also stayed running with an invalid web pool size of 0                                                                                                                     |
| Configured budgets and queue recovery | PASS           | `test:pools:db`: 36 concurrent public/private HTTP requests, actual PostgreSQL lock waits and session counts. The final build peaks at 3 web and 6 worker sessions, within budgets of 3 and 7 including supervisors. Releasing the locks lets every request succeed; service shutdown releases every labeled database session |
| Invalid configuration                 | PASS           | Actual production entry points exit 1 for zero, fractional and nonnumeric web limits, and for a worker pool of 1, which cannot support both a dedicated source-control session and ongoing queries                                                                                                                            |
| Local CI                              | PASS           | `npm run ci:local`: 212 first-party source files, maximum 495 lines, formatting, strict types, 18 tests, builds and built HTTP smoke                                                                                                                                                                                          |
| Restricted-pool regressions           | PASS           | Both runtime settings set to 2: database, HTTP, player WebSocket, media, management, provider, sample, terminology, language, process-recovery and subtitle-transport suites all pass against isolated PostgreSQL                                                                                                             |
| Production application                | NOT RUN        | Existing production web and TURN readiness was inspected read-only. The new pool settings and voice runtime have not been deployed; no production connection limit or credential was changed                                                                                                                                  |

The new test owns the process-environment and actual connection-usage contract.
It does not inspect private pool fields or add a production test endpoint. Two
worker pools are saturated concurrently while source polling continues; it is not
live Discord reception or a player-capacity benchmark. Existing process and
application suites retain ownership of authorization and physical-close behavior.
Production/tooling changes total +45/-9 lines; tests and test support total
+158/-1. Temporary databases and processes are removed after verification; the
separate authorized Discord preview remains active. No release was performed.

## Confirmed web-player process recovery — 2026-10-19

Both production services now use the shared `@babel/processes` supervisor. Each
player socket registers its process owner while holding the owner's row lock.
Only an observed child exit permits scoped cleanup and a new incarnation. Legacy
rows without an owner and owners lost with their supervisor remain unconfirmed.
The production web entry is now `apps/web/.output/server/supervisor.mjs`; migration
0011 adds nullable player ownership without inventing an identity for old rows.

| Check                     | Result  | Evidence                                                                                                                                                                                                                                                                  |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local CI                  | PASS    | Final `npm run ci:local`: 211 first-party sources, maximum 495 lines; formatting, strict types including both runtime wrappers, 18 tests, builds and built HTTP smoke                                                                                                     |
| Database ownership        | PASS    | Ten `test:db` cases in disposable PostgreSQL. Owned player registrations close with the confirmed owner; legacy rows stay open with null ownership; an exited owner cannot register another player connection                                                             |
| Actual process recovery   | PASS    | Final `test:recovery:db` passes both worker and web regressions. Real web SIGKILL closes the socket, persists its receipt and restarts automatically; reconnect retains the session ID and nickname generation                                                            |
| Scoped revocation         | PASS    | The same listener's socket on another web process survives the first crash. A locked receipt keeps nickname replacement JOINING until persistence succeeds; obsolete credentials receive only the terminal state, and an unrelated listener remains connected             |
| Normal shutdown           | PASS    | Actual SIGTERM sends close code 1012 and persists closure. This assertion failed with code 1006 before signal-time socket shutdown was added                                                                                                                              |
| Linux ARM64 images        | PASS    | Rebuilt web and worker images run as UID 1000, read-only, with capabilities dropped and no-new-privileges. Actual container WebSocket SIGKILL, receipt, same-identity reconnect, Access denial and normal SIGTERM exit 0 pass; normal socket close is 1012                |
| Development runtime       | PASS    | An isolated Nuxt development process registers a unique owner, reaches readiness and serves an authorized player socket. Missing/forged Access assertions remain denied. Development hard-crash recovery is deliberately not claimed                                      |
| Application regression    | PASS    | After the final build, isolated `test:db`, `test:http:db`, `test:ws:db`, `test:media:db`, `test:management:db`, `test:providers:db`, `test:samples:db`, `test:terms:db` and `test:languages:db` all pass                                                                  |
| Subtitle transport        | PASS    | Final `test:subtitles:db` passes real registered player delivery, independent original audio, authorization and stream cancellation using loopback providers                                                                                                              |
| Integrated Discord speech | NOT RUN | The separate authorized preview remains LISTENING, but its current generation still records zero speakers/frames and the real browser's audio energy is zero. Discord currently shows only the bot in the test channel. Earlier isolated DAVE speech is separate evidence |
| Supervisor/host recovery  | NOT RUN | Unknown owners after parent/container/host loss stay fail-closed. Multi-worker routing, production deployment and live Discord-to-browser speech acceptance remain outstanding                                                                                            |

The new WebSocket crash regression failed before supervision because its durable
registration never closed after the OS killed the process. Its final form also
protects other-process ownership, delayed receipts, replaced credentials and
normal shutdown. The existing database case owns storage fencing; it is not
presented as physical transport proof. No test-only production endpoint was added.

An early reconnect check used liveness while asynchronous Nitro initialization
was still running; the fixture now waits for readiness when a database is
configured. A development fixture initially omitted Access configuration and
correctly received 503; after supplying the normal test configuration, access
denial checks pass. One language regression failed during a concurrent output
rebuild; a stable-build retry passed. The cause of that initial startup failure
was not established from the suppressed server logs.

The existing five-case Coturn networking suite passed before the final web
shutdown adjustment. It covers real UDP/TCP/TLS relay, fallback, expiry, renewal,
invalid settings and bounded UDP allocation; it does not establish public-network
reachability. No release, production migration or deployment was performed.

Production/tooling changes total +268/-53 lines; tests and test support total
+254/-6, excluding documentation, generated migrations and the lockfile. The
disposable databases, containers, image tags and development processes were
removed; the separate active Discord/browser fixture remains available.

## Confirmed runtime crash recovery — 2026-10-19

A worker supervisor now observes its own child process exiting, persists scoped
media/source closure and then starts a new incarnation. Owner-row locks fence
late registration transactions. This covers child-runtime crashes while the
supervisor survives; whole-supervisor/container/host recovery remains unfinished.
See [worker recovery](worker-recovery.md).

| Check                   | Result  | Evidence                                                                                                                                                                                                                                                                                                                                      |
| ----------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local CI                | PASS    | Final `npm run ci:local`: 204 first-party source files, maximum 495 lines; formatting, strict types, 18 tests, web/worker/migration builds and built HTTP smoke                                                                                                                                                                               |
| Database ownership      | PASS    | `npm run test:db`: ten tests against an isolated disposable database. Exit waits for in-flight registration; terminated IDs reject media/source claims and re-registration; new source generation survives repeated old-owner confirmation                                                                                                    |
| Real process crash      | PASS    | `test:recovery:db`: actual ICE/DTLS peers, child SIGKILL, independently observed UDP release, automatic same-listener recovery, obsolete negotiation rejection and another runtime's surviving peer                                                                                                                                           |
| Blocked receipt         | PASS    | A real PostgreSQL row lock prevents exit persistence. The bounded query times out and retries; readiness remains unavailable until the receipt can commit                                                                                                                                                                                     |
| Linux ARM64 packaging   | PASS    | Built Docker worker runs as UID 1000 on a read-only filesystem with all capabilities dropped and no-new-privileges. Real child SIGKILL releases its UDP sockets, persists closure and restarts; same-listener negotiation resumes. Supervisor SIGTERM exits 0 and closes the fresh registration. This is not container-to-browser audio proof |
| Media and subtitles     | PASS    | Existing `test:media:db` verifies native Opus publication, scoped retirement, revocation, concurrent recovery and graceful supervisor restart. `test:subtitles:db` passes actual registered player delivery with loopback providers                                                                                                           |
| Media networking        | PASS    | Final `test:network:db`: all five Coturn/application checks pass, including UDP/TCP/TLS, fallback, real expiry, renewal, untrusted TLS, invalid startup, failed relay authentication and bounded UDP allocation                                                                                                                               |
| Wider crash recovery    | NOT RUN | Unknown owners after supervisor/container/host loss remain fail-closed. Web-owned player WebSocket orphan recovery and multi-worker routing remain unfinished                                                                                                                                                                                 |
| Fresh integrated speech | NOT RUN | Existing authorized Discord test is preserved; no new integrated speech frames were observed during this change. No live Discord crash/rejoin acceptance is claimed                                                                                                                                                                           |

The new process regression failed before the repair: the OS released the killed
worker's UDP sockets, but its persistent registration never closed. It passes
with supervision and durable reconciliation. An initial network rerun also
caught a changed generic startup diagnostic; the existing non-secret message was
restored, the worker rebuilt, and all five checks passed. An initial strict test
type error was corrected to use PostgreSQL's `PoolClient` type.

Recovery production/tooling changes total +323/-64 lines; tests and test support
total +473/-12 lines, excluding generated migrations and documentation.

Test databases, relay containers and the temporary image-check container were
removed. The active Discord preview remains separate. No production migration,
release or deployment was performed in this change.

## Explicit media networking — 2026-10-19

STUN/TURN configuration, independent temporary worker/browser credentials,
credential expiry and browser renewal are implemented. See
[media networking](media-network.md). This is local transport evidence; production
worker routing and real player-network acceptance remain unfinished.

| Check                                | Status  | Evidence                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local CI                             | PASS    | `npm run ci:local`: 197 source files, maximum 495 lines, formatting, strict types, 18 tests, builds and built HTTP smoke                                                                                                                                                                                  |
| Real relay transport                 | PASS    | Pinned Coturn 4.18.0-r0, real player HTTP authorization/private control and native Opus decoding. UDP, TCP, TLS and UDP-to-TCP fallback select relay candidates at both ends and decode nonzero audio                                                                                                     |
| Credential lifetime                  | PASS    | With a 60-second lifetime, publication stops, the actual peer closes and its close receipt persists. A subsequent attempt retains the listener generation and obtains different credentials. Coturn rejects expired credentials with actual 401; fresh credentials allocate through the same request path |
| TLS and invalid settings             | PASS    | TLS succeeds with the fixture CA trusted only in the test child; a separate process with no trust rejects it. Incomplete credentials, invalid URLs, unsafe lifetime and incomplete port configuration fail actual worker startup with a generic message                                                   |
| Relay authentication failure         | PASS    | A reachable Coturn with a mismatched secret returns no usable offer: Babel responds 503, reveals no relay credential and persists actual negotiation closure                                                                                                                                              |
| Direct/STUN port configuration       | PASS    | Two simultaneous authorized peers gather actual STUN candidates, use distinct ports in the configured local UDP range, decode audio and release their OS sockets after closure                                                                                                                            |
| Chrome UDP/TCP and renewal           | PASS    | Real Chrome stats show relay at both ends, UDP/TCP relay protocols and nonzero audio energy. TCP completes multiple renewals with one open peer and one audio element; database evidence retains one session and one nickname generation                                                                  |
| Existing media and subtitle delivery | PASS    | Real publication/admission/replacement/recovery suite passes. Subtitle suite passes independently and in a nested disposable database. Teardown initially triggered PostgreSQL `57P01`; the fixture now waits for server-side disconnection and drops its database without FORCE                          |
| Public network and deployment        | NOT RUN | Public NAT/TURN routes, China mainland players, production TLS/browser trust, native AMD64 relay performance and end-to-end Discord speech latency                                                                                                                                                        |

The first isolated relay probe advertised host loopback from Docker. Allocation
succeeded, but Coturn rejected relay permissions. The corrected fixture relays
both endpoints within its Docker network, without exposing relay ports or enabling
loopback-peer exceptions. An initial expiry assertion observed only a Werift
timeout: its integrity guard drops unsigned post-authentication errors. The final
check reads the real TURN error response and requires a fresh-credential positive
control, so network failure cannot count as authentication denial.

Two runs exposed a test teardown race: `pg-pool.end()` removes clients from its
inventory before their socket-close callbacks finish. Immediate `DROP DATABASE
... WITH (FORCE)` could therefore terminate a still-closing client with `57P01`.
The shared fixture now observes zero connections in `pg_stat_activity` before a
normal database drop. No production database lifecycle behavior was changed.

Default host-only networking now uses ICE-lite. Inspection of the exact Werift
dependency showed that an empty `iceServers` list alone still selected its built-in
Google STUN fallback; the earlier “no implicit external STUN” statement was not
true for that previous configuration. The current configuration suppresses that
fallback. Existing direct admission and subtitle transport checks pass with it.

The test-authoring gate assigns the new suite ownership of actual relay, lifetime,
TLS and port-binding contracts; existing tests retain application replacement and
subtitle ordering ownership. No production test endpoint or TLS bypass was added.
Temporary relay containers, generated secrets/certificates, browser previews and
their databases are removed after use. The separate live Discord/browser test
remains available for a new authorized speech sample. No deployment is claimed.

## Authorized shared subtitle delivery — 2026-10-19

Per-member decoded PCM now feeds shared recognition and output-language
translation independently of original playback. Private HTTP streams relay
current authorized results through the existing player WebSocket to the main
page and PiP. Language activation requires current sample proof and worker
readiness. Fresh installations still have no enabled languages or credentials.

| Check                                       | Result  | Evidence                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local CI                                    | PASS    | `npm run ci:local`: 191 first-party source files, maximum 495 lines; formatting, strict types, 18 tests, web/worker/migration builds and HTTP smoke                                                                                                                                                               |
| Actual subtitle transport                   | PASS    | `test:subtitles:db`: built web, private NDJSON HTTP, registered player WebSockets, independent disposable PostgreSQL and loopback provider protocols. Three listeners share one recognition connection and two translation requests for two languages                                                             |
| Independent sources and stale work          | PASS    | Nonzero synthetic stereo PCM reaches separate mono recognition connections at 48 kHz. Same display names retain different member IDs. New listeners receive no prior work; language/source/provider replacement discards late results                                                                             |
| Runtime configuration and release           | PASS    | A saved credential replacement takes effect without deployment and preserves recognition; disabling all languages updates public configuration, closes actual recognition sockets and prevents held translations from delivery                                                                                    |
| Original audio and nickname replacement     | PASS    | Actual WebRTC receiver keeps receiving packets during held translation and quota failure. Same-nickname replacement waits for the old player socket and real media UDP ports to close; old credentials receive no subtitles                                                                                       |
| Display ordering regression                 | PASS    | A late subtitle revived a stopped source before the fix; the owner-boundary test fails with `1 !== 0` before the source-retirement fence and passes afterward. Other checks cover revisions, stream/configuration ordering and translation completion order                                                       |
| Database and built API regressions          | PASS    | `test:db` (nine tests), HTTP, WebSocket, media, management, providers, samples, terminology and language suites pass in a separate disposable database; no live-test room data changed                                                                                                                            |
| Browser main page and PiP controls          | PASS    | Chrome/macOS displays two synthetic sources, clears old language on switch, retains selected language on quota failure, clears disabled subtitles and retains connected media. PiP opens/closes through normal controls; receipts show one player socket and one media peer in total; no captured warnings/errors |
| Native PiP pixels and live provider quality | NOT RUN | Mac locked during native window inspection. Synthetic provider responses do not prove recognition/translation quality, live latency, native PiP contents or game behavior                                                                                                                                         |
| Integrated Discord speech                   | NOT RUN | Earlier isolated DAVE speech/rejoin passed. The application listener is connected but the pending new sample still has zero speakers/frames and browser signal energy zero; silence is not spoken-audio proof                                                                                                     |

All new protocol inputs and translations are explicitly synthetic test fixtures;
there is no production synthetic-input endpoint or fabricated activation receipt.
The integration test owns authentication, transport, cancellation and physical
closure. The display reducer owns UI ordering; provider tests retain the queue
and revision contracts. Temporary subtitle databases/servers were removed after
verification. The separate Discord test remains open for the requested speech.
No release or deployment was performed in this change.

## Original-audio worker integration — 2026-10-19

The worker now connects configured Discord voice sources, independently decodes
members and publishes bounded mixed playback over the existing revocable media
transport. Start requests, source status and actual member frame counts are
available in administration. Live provider subtitles and full product acceptance
remain incomplete.

| Check                                  | Result  | Evidence                                                                                                                                                                                                                                                                           |
| -------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local CI                               | PASS    | `npm run ci:local`; 179 first-party source files, largest 495 lines; formatting, strict types, 16 tests, production builds and HTTP smoke                                                                                                                                          |
| Migration and ownership                | PASS    | Migration 0009 applied to disposable PostgreSQL 16; `test:db` passes nine tests including actual ownership-session termination, duplicate controller exclusion, unconfirmed-owner refusal and persisted start/stop                                                                 |
| Mixer                                  | PASS    | Native Opus output independently decoded: 48 kHz stereo/960 samples per channel, separate speaker channels, 10 ms input assembly, pause preservation, 100 ms backlog bound and cessation after permission loss/close                                                               |
| Publication and source retirement      | PASS    | Actual WebRTC peers receive nonzero synthetic PCM only in the correct room. Source retirement releases real UDP sockets, persists close receipts, fences a pending offer held on the real nickname lock, and permits the same listener to reconnect                                |
| Built application regressions          | PASS    | `test:management:db`, `test:media:db`, `test:http:db` and `test:ws:db`; authenticated start/status boundaries, same-origin denial, old-credential refusal, replacement, concurrent recovery and graceful media-worker restart                                                      |
| Linux ARM64 native boundary tests      | PASS    | Five bundled source-boundary tests run inside the Node 24.18.0/Alpine worker image as UID 1000 on a read-only filesystem: native mixing, PostgreSQL ownership and actual local WebRTC source retirement. Initial Opus compilation failed; the ARM64 declaration macro corrected it |
| Linux AMD64 source-boundary tests      | PASS    | The final AMD64/Alpine image passes the same five native decoding, ownership and actual local WebRTC tests under Docker emulation on the ARM64 host. This is architecture compatibility evidence, not native AMD64 performance or live Discord receipt.                            |
| Worker runtime packaging               | PASS    | The final ARM64 and emulated AMD64 images run as UID 1000 with a read-only filesystem, no capabilities and no-new-privileges. Built web entry, authenticated offer/close, persisted transport closure and SIGTERM exit 0 pass; this does not establish container-to-browser ICE.   |
| Worker dependency audit                | PASS    | The Opus installer brought tar 6.2.1; root override and refreshed lock resolve 7.5.22. Actual installer resolution is checked and worker-only production npm audit reports zero findings. Broader workspace toolchain advisories are outside this worker-only result               |
| Live application connection            | PASS    | Real encrypted bot configuration saved through authenticated local management API; start request reaches LISTENING and a real Chrome listener receives Opus silence with one audio element playing and no capture request                                                          |
| Live source stop/restart               | PASS    | Browser management stop reaches STOPPED with no open source receipt; start advances source generation from 4 to 6 and rejoins Discord. The existing Chrome listener replaces its closed peer, resumes real Opus receipt and retains one audio element and the original entry time  |
| Live application speech                | NOT RUN | Browser connection and silence are not proof of spoken audio. A further authorized sample is requested after the integrated receiver becomes ready                                                                                                                                 |
| Multi-member and production acceptance | NOT RUN | Simultaneous speakers, matching nicknames, member re-entry, Go Live, native AMD64 performance, Linux live reception, production networking, background/game/PiP behavior and end-to-end latency/capacity remain open                                                               |

The new mixer and publication tests own signal conversion and source retirement;
the existing media suite continues to own HTTP admission and nickname revocation.
Ownership tests exercise real PostgreSQL locks but do not simulate or claim
physical Discord-close receipts. See [original audio](original-audio.md).

## Configurable Discord capture scope — 2026-10-19 (historical)

The administrator can select specific Discord members or every speaking channel
member. All-channel configuration needs no commander IDs. The existing selected
scope is the migration default, and changing scope stops the desired source and
advances its generation. Actual speaker discovery and audio publication remain
unfinished; this change does not claim a live receiving worker.

| Check                                       | Status  | Evidence                                                                                                                                                                                                                                                |
| ------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local CI                                    | PASS    | `npm run ci:local`; 166 source files, maximum 494 lines, strict types, 14 tests, web/worker/migration builds and HTTP smoke                                                                                                                             |
| Migration and database regression           | PASS    | Migration 0008 applied to disposable PostgreSQL 16; `npm run test:db` passes seven tests                                                                                                                                                                |
| Capture scope through built management HTTP | PASS    | `npm run test:management:db`: selected default, all-channel completeness with no member IDs, invalid mode rejection, scope-change stop/generation, unchanged generation on rename, incomplete empty selected list and persistence across server restart |
| Browser configuration                       | PASS    | Chrome/macOS: all-channel save and refresh retain the mode and hide the ID field; keyboard switching restores the selected-member field; reloading saved state restores all-channel; no captured warning/error entries                                  |
| Bot identity and guild installation         | PASS    | Credential stays in ignored mode-0600 `.env`; official bot API confirms the expected identity, installed test guild and selected private voice channel                                                                                                  |
| Isolated native candidate loading           | PASS    | Node 24/macOS arm64 loads `@discordjs/voice` 0.19.2 with DAVE, `discord.js` 14.27.0 and `@discordjs/opus` 0.10.0; a known Opus silence packet decodes to 3,840 PCM bytes; natural exit 0                                                                |
| Private-channel access                      | PASS    | Approved browser grant is saved; official bot API confirms a member override with only ViewChannel and Connect (allow 1049600, deny 0)                                                                                                                  |
| Voice transport connection                  | PASS    | Isolated bot with Guilds and GuildVoiceStates intents reaches Ready with self-mute enabled and self-deafen disabled; DAVE protocol 1 completes a ready group session after an authorized member joins                                                   |
| Live DAVE and independent decoding          | PASS    | Real member audio: 1,129 packets decoded to 48 kHz stereo signed-16 PCM, 884 nonzero frames, peak 16,904; every decoded frame observed DAVE protocol 1 ready; zero decoder or voice errors                                                              |
| Rejoin and native cleanup                   | PASS    | First receiver closes and exits 0; a fresh receiver rejoins with a member present and decodes 62 DAVE frames, 53 nonzero frames, peak 1,156, zero errors; second receiver also closes and exits 0                                                       |
| Multiple sources and application delivery   | NOT RUN | One real member was observed. Simultaneous users, identical nicknames, member re-entry, Go Live audio, Linux live reception and application/browser original-audio delivery remain integration gates                                                    |

`design.md` and `GOAL.md` are synchronized with the requested all-channel mode and
identity limits: one member's locally mixed microphone/game/music is one source.
The existing built HTTP suite owns the new persisted contract; no parallel unit
suite or test-only production seam was introduced. Private fixture IDs, token,
probe dependencies and screenshots remain in ignored local task files. No release
or deployment was made.

## Revocable media admission — 2026-10-19 (historical)

The application now uses Werift 0.25.1 for authenticated, receive-only WebRTC.
The worker registers each negotiation under the global nickname lock, closes
actual peers before acknowledging replacement and rejects obsolete credentials.
The production audio track is empty: Discord reception and PCM publication remain
unfinished. No synthetic source or fake transport acknowledgement was added to
the application. See [media admission](media-admission.md) for configuration.

| Check                                      | Status                    | Evidence                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local CI                                   | PASS                      | `npm run ci:local`; 166 first-party source files, maximum 494 lines, strict types, 14 tests, web/worker/migration builds and HTTP smoke                                                                                                                                                                    |
| Migration 0007 and database regressions    | PASS                      | Applied media registration migration to disposable PostgreSQL 16; `test:db` passes seven tests; `test:http:db`, `test:ws:db` and `test:management:db` pass against built servers                                                                                                                           |
| Real media admission                       | PASS                      | `test:media:db` uses two built web processes, the real worker and actual ICE/DTLS peers; receive-only negotiation connects, unauthorized private control returns 401, invalid listener credentials return 401 and foreign origins return 403                                                               |
| Actual closure and replacement             | PASS                      | OS UDP binds independently prove candidate sockets occupied before close and released afterward. A held database close receipt keeps replacement JOINING even after socket release; both media and player socket closure are required                                                                      |
| In-flight admission and old credentials    | PASS                      | Replacement queued before an old offer on the nickname lock makes that offer return 410 without inserting a media registration. The replacement obtains an actual connected peer; old credentials cannot reopen media                                                                                      |
| Reconnect ordering                         | PASS                      | Same-ID open offer is idempotent; obsolete attempts/IDs return 409 without closing the newer peer. Three overlapping recoveries with delayed close persistence initially failed, then passed after closing only earlier attempts; one actual peer survives                                                 |
| Scope, subscription and restart            | PASS                      | Delayed old-generation revocation leaves the current peer intact. Null-language update preserves identity and occupied sockets. Graceful worker restart closes old sockets/receipts and reconnects the same listener under a new worker owner                                                              |
| Linux arm64                                | PASS                      | Same actual media suite, including overlapping recovery, passes on Node 24.18.0/Alpine as user `node` in the disposable PostgreSQL container network namespace                                                                                                                                             |
| Worker runtime image                       | PASS                      | `voice-worker` target runs as UID 1000 with a read-only filesystem, all capabilities dropped and no-new-privileges. Actual web entry becomes ACTIVE, offer/close persist a real receipt, private readiness is authenticated and SIGTERM exits 0. This packaging check does not claim host-to-container ICE |
| Browser media lifecycle                    | PASS                      | Chrome/macOS: connected peer, mute toggle, refresh retains the same listener/generation with one open media row; PiP open/close adds no media row; second entry replaces the first, old-page refresh stays at entry, and explicit leave leaves no open media rows                                          |
| Browser layout and errors                  | PASS                      | New controls fit a 320 px document/viewport without horizontal overflow; default viewport restored; no captured warnings/errors in either test tab                                                                                                                                                         |
| Discord credential and guild discovery     | WAITING FOR CONFIGURATION | Ignored mode-0600 `.env` credential returns the expected bot identity and HTTP 200. Guild lookup still returns an empty list; installation, voice channel and commander selection are pending                                                                                                              |
| Hard crashes and production routing        | NOT RUN                   | Unknown transport owners remain fail-closed. Confirmed orphan recovery, multiple-worker routing, exclusive guild control, public ICE/TURN, Linux amd64 and actual player networks are unfinished                                                                                                           |
| Original audio and full product acceptance | NOT RUN                   | No Discord/DAVE receipt, per-commander PCM publication, live provider quality, authorized player subtitles, native PiP pixel/closure proof, background audio, AION2 display modes or latency/capacity evidence                                                                                             |

The new media suite owns real admission and transport lifecycle at the built HTTP
boundary. Existing database tests continue to own transactional behavior with
controlled transport ports; the candidate harness owns synthetic decoding and
native runtime compatibility. `design.md` and `GOAL.md` remain byte-identical.
No release or production deployment was made. Local evidence and credentials
stay in ignored task files; source/history contain no real secrets.
Owned browser previews, test processes, containers, volumes, networks and local
image tags were removed. The unmerged worktree and its local credential remain
preserved.

## Isolated media compatibility checks — 2026-10-18 (historical)

Candidate SDKs now have a separately installed validation harness. Application
dependencies and behavior are unchanged: the worker remains stopped, listeners
remain JOINING, and live Discord original audio is not available.

| Check                                                                               | Status                    | Evidence                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local CI                                                                            | PASS                      | `npm run ci:local`; 155 first-party source files, maximum 494 lines, strict types, 14 tests, production builds and HTTP smoke                                                                                                                     |
| Werift synthetic RTP and sender shutdown                                            | PASS                      | Node 24.18.0 / macOS arm64; at least 50 Opus packets and 9,533 payload bytes received over actual peers. Closing only the sender stops further reception; source and receiver remain active during observation; child exits naturally with code 0 |
| Browser decoding and shutdown                                                       | PASS                      | Chrome receives 3,855 packets / 846,815 bytes; decoded RMS peak 0.06296. Server close stops packets, RMS returns to zero, and replaying the closed answer receives 404. One muted audio element; no captured browser warnings/errors              |
| Failed-source negative control                                                      | PASS                      | An unavailable FFmpeg executable makes the real transport check fail at `receive-rtp`, exit 1, without a timeout; no synthetic success is supplied                                                                                                |
| Native wrtc cleanup                                                                 | FAIL                      | `@roamhq/wrtc` 0.10.0 creates/stops a native audio track, then terminates with SIGSEGV on macOS arm64. The parent correctly reports FAIL despite the stop call completing                                                                         |
| LiveKit synthetic media and removal                                                 | PASS                      | Server 1.13.10 / native SDK 1.1.0 / server SDK 2.19.1 on Linux arm64: 137 decoded frames, peak sample 705; RemoveParticipant emits client disconnection and the server list confirms absence; native cleanup completes                            |
| LiveKit old-token revocation                                                        | FAIL                      | The exact unexpired listener token reconnects after removal; the isolated command exits 1 with `oldTokenRejoined: true`. No admission gateway is implemented or claimed                                                                           |
| Discord REST access and guild discovery                                             | WAITING FOR CONFIGURATION | Bot token remains in ignored mode-0600 `.env`; authenticated guild lookup returns 200 and an empty list. Installation, voice channel and commander selection are pending                                                                          |
| Babel credential revocation, live Discord, deployment transport and player networks | NOT RUN                   | The probes do not enter application sessions, authorize real command delivery, test DAVE or prove TURN/network/game behavior                                                                                                                      |

See [media compatibility](media-compatibility.md) for exact versions, reproduction
commands, platform limits and selection implications. No production media SDK was
added. The harness uses identified synthetic audio and isolated fixture credentials.
Temporary browser/encoder processes and both experimental Docker networks were
removed; the unmerged implementation worktree and local credential remain preserved.

## Player subtitle window and Discord credential check — 2026-10-18 (historical)

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

- A second speaking member for live source-separation and simultaneous-speaking
  checks, followed by member leave/re-entry. Single-member audible playback is
  human-confirmed. The existing all-channel mode
  does not require a commander-ID list; the production bot credential is saved
  and the source is connected. Graceful worker replacement passed; abrupt-loss
  fencing evidence is still pending.
- Selected provider credentials and authorized battle-command samples for
  language-specific quality checks after configuration.
- An unlocked supported browser/device, the actual AION2 display mode, and player
  network access for native-window, background, end-to-end and capacity checks.

Werift has already been selected and local revocation/relay checks passed. These
inputs concern the remaining production and live acceptance work; the shipped
web application can keep its language list empty until paths are validated.

## Git and task cleanup

The implementation, web-release evidence, published-image rollback rehearsal
and status reconciliation are merged in application PRs #1–#4. The private
release workflow published the verified web and voice images. At the user's
request, infra changes were made in its primary checkout and pushed directly;
ArgoCD then deployed both runtimes and the relay policies.

The Codex-managed `babel-implementation` worktree is retained for unfinished
live-audio work. Its local credential, preview configuration and test evidence
are ignored by Git; the earlier preview process is no longer serving its port.
Rehearsal containers, databases, temporary registry credentials and downloaded
images were removed. Final preview/worktree cleanup follows completion of the
remaining live work and remote integration verification; other tasks are preserved.

The latest local directory check covered 72 unarchived task records and found
no missing paths or lookup errors. The accessible app task list reported no
unavailable host or source. Remote-host path existence was not independently
verified by a remote filesystem probe.
