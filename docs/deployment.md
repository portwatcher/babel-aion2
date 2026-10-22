# Deployment

Target website: `https://babel.juryquinn.com`; administrator page: `/admin`.
Application source: `https://github.com/portwatcher/babel-aion2` (private today,
intended for future open source).

Production infrastructure and deployment-specific tooling live in the separate
private infra repository. The source repository has generic ser7 CI and automatic
main releases; production destinations and credentials use repository variables
and GitHub Secrets. Environment details, database connections and Access
configuration remain in private infra.
See [source and secret boundaries](source-and-secrets.md).

## Application package

`Dockerfile` builds the Nuxt Node server and a standalone PostgreSQL migration
runner and the independent Pod-recovery entry point with Node 24.22.1. The runtime runs as UID 1000. It contains no production
configuration or credentials and does not start the optional voice worker.
The `voice-worker` build target packages Discord/DAVE reception, shared subtitle
processing and private WebRTC admission with pruned dependencies and UID 1000.
Keep its authenticated control service private. Source ownership and explicit
[STUN/TURN settings](media-network.md) are implemented. The private infra release
now publishes and deploys both images with authenticated control, explicit pool
budgets and existing TURN routing; see the current verification below.
The recovery Deployment uses the web image with `node recovery/index.mjs`, a
namespace-scoped Kubernetes token and only the database connection secret.
See [Kubernetes recovery](kubernetes-recovery.md) for admission and evidence rules.

The migration command is `node database/migrate.mjs` with `DATABASE_URL` supplied
at runtime. The infra release applies migrations before starting the new web
release. The application uses private `NUXT_DATABASE_URL` and administrator
settings from the deployment secret.

`/api/health/live` checks the HTTP process. `/api/health/ready` requires a migrated
database. Neither endpoint proves live audio, subtitle quality, or the Cloudflare
policy. Public player access remains separate from administrator Access.

## Release contract

The automatic workflow checks out an exact Babel commit and runs `npm run
ci:local`, real PostgreSQL migrations, session, administrator and community-room
tests, and container runtime checks before image publication. The actual worker
image must pass native Opus encode/decode, non-root read-only startup,
authenticated media/subtitle readiness, unauthorized rejection and graceful
shutdown against a disposable database. Each release uses
an immutable tag and records the source commit in OCI labels. Existing GitOps
resources are updated only after publication; ArgoCD owns reconciliation.

The first image can be published before the initial Kubernetes resources exist.
Those resources are then committed in infra with the verified image reference.
Subsequent releases update their image references through the same workflow,
including the recovery controller's web-image reference.
No production image is published from a local checkout.

Node 24.22.1 includes the upstream fix for
[CVE-2026-111497](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases).
All build and runtime stages use its digest-pinned official Alpine image. The
media-validation probe uses the matching digest-pinned Debian image. `check:runtime`
verifies the exact Node version and the upstream malformed Brotli regression in
both synchronous and streaming decoders. `ci:local` runs it before other checks;
the release repeats it inside both packaged images with networking disabled and
a read-only filesystem before publication. Web, migration and recovery share
the verified web image.

## Automatic main releases

`.github/workflows/ci.yml` runs on pull requests targeting `main`, pushes to
`main`, and manual dispatch. Pull requests, including forks, run the `checks`
job on GitHub-hosted `ubuntu-latest` with no secrets. Pushes to `main` run the
`release` job on `[self-hosted, Linux, X64, ser7-homelab]` in the `production`
environment, whose deployment branch policy allows only `main`. That runner uses
the established shared admission, resource limits and managed `ci-builder` from
private infra. Fork workflow runs require approval for every external
contributor; read `.github/` changes before approving one, because a fork runs
its own copy of the workflow.

Pull requests run `npm run ci:local`, repeatable migrations, `test:db`,
`test:management:db` and `test:community:db` against disposable PostgreSQL.
Only a current `main` commit can continue to production. The workflow builds
Linux AMD64 web and voice images, verifies the packaged migration, non-root web
startup and native voice runtime, then pushes both validated images. Tags contain
the full source SHA, workflow run ID and attempt; OCI labels record source and
revision. Source secrets are never Docker build arguments.

Configure these values through GitHub settings. Store the secrets on the
`production` environment, not the repository:

| Kind     | Name                 | Purpose                                                 |
| -------- | -------------------- | ------------------------------------------------------- |
| Variable | `IMAGE_REGISTRY`     | Existing DigitalOcean registry path, without image name |
| Variable | `INFRA_REPOSITORY`   | Private infra repository, in `owner/repository` form    |
| Secret   | `DOCR_DOCKER_CONFIG` | Write-capable registry Docker configuration JSON        |
| Secret   | `INFRA_DEPLOY_KEY`   | Dedicated SSH write deploy key registered in infra      |

The workflow reuses private infra's image updater and voice image probe. The
updater atomically commits the web, migration, recovery and voice image references
to infra `main`, with bounded fetch/rebase retries for concurrent infra commits.
ArgoCD then applies migrations and reconciles the workloads. Workflow success
confirms publication and the GitOps commit; check ArgoCD health and application
readiness separately to establish deployment success.

Main runs are serialized. Before publication and again before the GitOps update,
the workflow checks the current remote `main` SHA; superseded runs stop without
updating deployment tags. Registry files, temporary environment files and locally
loaded release images are removed even after failures. Checkout removes its SSH
key during post-job cleanup. Production runtime secrets stay in the existing
secret store; adding a CI secret does not configure Discord OAuth for room creation.

Completed coding work is automatically pushed through a checked pull request and
merged into `main`, unless the user explicitly requests an unmerged change. This
starts the automatic release; see `AGENTS.md` for integration requirements.

## Remaining product work

Player WebSockets, persistent sessions, provider/language administration, a PiP
window, revocable media admission, per-member Discord reception, PCM publication
and authorized shared subtitles are implemented. Live audio/provider acceptance,
native PiP/game behavior, restricted player networks and capacity remain unfinished. A JOINING
connection cannot receive commands. Production may start with an empty language
list; the administrator later validates and enables configured paths.
See [validation](test-report.md) for local and production evidence. Production
web/worker rollout, one real member's Discord speech and human-confirmed browser
playback are verified; multiple-member and full player-network acceptance remain
separate gates.

Verify Access, database readiness, routing, and actual rollout state separately.
Use the private infra runbook for operational credentials, backup and recovery.

## Current web and voice verification — 2026-10-19

Source `e5a7499ed7558e5d8ed34590053c0806b2480ccd` includes the Pod-recovery
implementation merged in [PR #10](https://github.com/portwatcher/babel-aion2/pull/10).
The private Linux AMD64 workflow passed CI with 18 tests, 11 PostgreSQL tests,
repeatable migrations and both packaged runtime probes before publishing:

- Web and recovery: `sha256:5dabe0495f153c5200f48cf60776cdb3b4abda1223feb0f5fc2ef2e3eb7b11b2`.
- Voice: `sha256:335f712c94ae02eef67124a45ade5862f5b206792ad89e95ab4b9378515f3cc0`.

GitOps applied the thirteenth migration, then the private controller, two web
replicas and one voice worker. At 04:09 UTC, all were ready with zero restarts,
running the published digests; ArgoCD reported Synced / Healthy. Runtime owners
match all three supervised Pod UIDs and the required finalizers are present.
The controller's probes return 200. Its role allows only namespace Pod operations;
Secret reads, cluster-wide Pod listing and Pod-status mutation are rejected.
Web and voice Pods continue to have no Kubernetes token.

Room settings and the saved encrypted credential remained unchanged. The open
Chrome listener recovered its media connection without a refresh, keeping its
session and generation; the management page remained authenticated. Discord
needed repeated connection attempts before returning to LISTENING, generation 22. The old source closed at 04:02:13 UTC and the successful source was claimed
at 04:04:03; it was observed healthy at 04:06 and 04:09. This is automatic recovery,
not uninterrupted audio; the transient cause remains unconfirmed. No new speech
or provider configuration was supplied in this rollout check.

The earlier single-member audible result below remains valid evidence for that
run. Isolated whole-container failures pass, but destructive production failure
and unknown-host fencing remain unverified. See the
[recovery rollout report](test-report.md#production-recovery-controller-rollout--2026-10-19).

## Initial web and voice verification — 2026-10-19

Source `4b763079b5c07261ce64845d8c4c58121eb1edb6` was released through the
private self-hosted Linux AMD64 workflow. Local-equivalent CI passed 18 tests;
PostgreSQL validation passed ten tests. Both packaged runtime checks and three
private release-helper tests passed before either image was published.

ArgoCD completed migration and reports Synced / Healthy. Two web replicas and
one voice worker are ready with zero restarts. Their actual image digests match
publication:

- Web: `sha256:3241e7d7010e30d9a0ba4e98dfe7eae84f3eb6521f126dafacc6752d906107d3`.
- Voice: `sha256:b70476ec41eb360a665249ca392377aaa3d4cd461baeb8184e9fa536b9e53a87`.

Web-to-worker media and subtitle readiness returned 200 with the configured
credential, and 401 with missing or incorrect credentials. The public lobby,
configuration, health endpoints and 19 frontend assets returned 200; protected
administrator paths redirected to Access. Checked public responses contained
none of the configured sensitive values. Runtime configuration remains in infra.

The existing public TURN service passed UDP/TCP allocation and bidirectional
data forwarding. A separate probe from the actual non-root worker exchanged ten
packets each way with an external relay client through the deployed policies.
Both worker and browser require relay candidates. A real Chrome listener entered
through the normal public form and displayed a connected original-audio channel.
Normal exit then returned the online list to zero; persistent socket/media close
receipts were confirmed and no ACTIVE/JOINING listener remained.

The initial rollout sampled at most eight database connections. A later readiness
probe observed nine, below the role limit; these idle checks are not a capacity
test. Pool settings account for web rollout overlap and the worker's separate
pools. Operational values and network policy details stay in private infra.

The human administrator subsequently completed Access login. Through the normal
management form, the existing authorized bot credential and test channel were
saved with ALL_CHANNEL capture; saving and starting were separate operations.
The worker reported LISTENING, no failure reason and zero observed speakers at
01:59 UTC. A second normal Chrome listener connected while this source was live.
The earlier local preview is no longer running, so it does not compete for the bot.
The first start temporarily retried; the next start connected without an image,
permission or network-policy change. That transient failure remains unexplained.

The first human playback attempt produced no sound while the human Discord
account was outside the voice channel. After joining the configured channel,
the production source reported that member's correct identity and 282 decoded
frames at 02:03 UTC, still on generation 9 with no failure reason. No recording
was retained. Audible playback was unconfirmed at that stage; after the relay
correction below, the human confirmed hearing their own Discord voice through
the production Babel webpage. Multiple members were not tested.

Provider/language lists remain empty. These checks prove administrator setup,
single-member Discord receipt, media connectivity and human-confirmed browser
playback. They do not establish provider quality, TURN TLS/restricted-network compatibility, mainland-China performance,
native game-window behavior, host-loss fencing or production disaster recovery.

Subsequent production checks passed real Chrome nickname replacement, persistent
same-session refresh, administrator removal and PiP closure. A graceful worker
rollout exposed a cross-node TURN problem: the node-public TCP endpoint timed out
from the new node. The existing cluster Service passed authenticated bidirectional
relay traffic from that same pod, so private infra now uses it for the worker's
TURN endpoint while browsers keep the public endpoints.

After that correction and normal GitOps replacement, the browser reconnected
without manual refresh or a new listener. Stored settings and encrypted
credentials remained identical; old owners and transports have closure receipts.
The new Discord source reported 29 decoded frames at generation 11. See the
[production lifecycle report](test-report.md#production-sessions-and-graceful-worker-recovery--2026-10-19)
for the evidence and remaining multiple-member, game and abrupt-loss limits.

A read-only production database snapshot subsequently passed isolated restoration
with the same published web image and production database image. All 19
application/migration tables, schema, sequence values and the saved encrypted
Discord credential survived; the restored web runtime passed readiness while old
unconfirmed transport records remained unconfirmed. Production settings and pods
were unchanged. This is isolated restore evidence, not live production failover;
see the [restoration report](test-report.md#production-snapshot-restoration--2026-10-19).

## Earlier web release verification — 2026-10-19

Source `bbe9fc204d61b37a46284581416504bc172cb46e` was released through the
existing private workflow after PR #1 merged. The self-hosted Linux AMD64 run
passed local-equivalent CI, 18 tests, ten PostgreSQL tests, migration checks and
the non-root container smoke check before publication. ArgoCD completed the
production migration hook, then rolled both web replicas to the published image.
The application is Synced / Healthy; both replicas are ready with zero restarts
and the same published digest:
`sha256:100414b36f271318c67784f9915580bea41b0c5f31df81dee6eda3f1301239aa`.

The lobby, player configuration, liveness, readiness and 19 frontend assets return 200. Real Chrome displays the updated lobby with an empty online list and no
console errors. Nickname entry is available; the source remains UNCONFIGURED and
languages remain empty. Without a production media worker, listener admission
stays JOINING and cannot deliver commands. No production test listeners were made.

Administrator pages, management APIs and administrator auth endpoints redirect to
Access. Direct origin requests reject missing assertions, email headers and
cookies alone with 401, and a forged assertion with 403. The running application
retrieves Access signing keys successfully. Runtime-side checks found none of the
five configured sensitive values in the lobby, public configuration or 19 assets;
those values were not copied into reports.

Authenticated administrator use, production voice/TURN routing, provider quality,
capacity, disaster recovery and rollback remain unverified. Configure database
pool budgets in private infra for worker replicas and rolling-update overlap
before enabling production command delivery. This web release does not establish
those acceptance results.

## Initial release verification

The scaffold from source `09bbb8bf88600df29edea0f0e63792aaa746129e` was
released on 2026-10-18 through the private self-hosted pipeline. ArgoCD completed
the migration hook and reported Synced / Healthy with two ready web replicas.
Both replicas ran the same digest verified in the registry after publication.

Live HTTPS checks returned 200 for the lobby, frontend assets, public player
configuration, liveness, and database readiness. The public configuration kept
languages empty and entry disabled. No production secret values appeared in the
checked HTML, configuration, or built frontend assets.

Administrator pages and APIs redirected to Cloudflare Access. Direct origin
checks rejected missing assertions, email headers and cookies alone, and forged
assertions. The running application could retrieve Access signing keys. A browser
check confirmed the dark lobby and the real Access sign-in page. Authenticated
administrator sign-in still requires a real authorized human login and was not
completed by this deployment check. Production restore and rollback were not
rehearsed. See [the validation report](test-report.md) for the remaining limits.
