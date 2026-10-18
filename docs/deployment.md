# Deployment

Target website: `https://babel.juryquinn.com`; administrator page: `/admin`.
Application source: `https://github.com/portwatcher/babel-aion2` (private today,
intended for future open source).

Production infrastructure and the regular release workflow live in the separate
private infra repository. Environment details, registry settings, database
connections, Access configuration, and deployment credentials are kept there.
See [source and secret boundaries](source-and-secrets.md).

## Application package

`Dockerfile` builds the Nuxt Node server and a standalone PostgreSQL migration
runner with Node 24.18.0. The runtime runs as UID 1000. It contains no production
configuration or credentials and does not start the optional voice worker.
The `voice-worker` build target packages Discord/DAVE reception, shared subtitle
processing and private WebRTC admission with pruned dependencies and UID 1000.
Keep its authenticated control service private. Source ownership and explicit
[STUN/TURN settings](media-network.md) are implemented; production worker images,
public relay routing and firewall rules remain separate private infra work.

The migration command is `node database/migrate.mjs` with `DATABASE_URL` supplied
at runtime. The infra release applies migrations before starting the new web
release. The application uses private `NUXT_DATABASE_URL` and administrator
settings from the deployment secret.

`/api/health/live` checks the HTTP process. `/api/health/ready` requires a migrated
database. Neither endpoint proves live audio, subtitle quality, or the Cloudflare
policy. Public player access remains separate from administrator Access.

## Release contract

The private infra workflow checks out an exact Babel commit through a read-only
deploy key. It runs `npm run ci:local`, real PostgreSQL migrations and session
tests, and container runtime checks before image publication. Each release uses
an immutable tag and records the source commit in OCI labels. Existing GitOps
resources are updated only after publication; ArgoCD owns reconciliation.

The first image can be published before the initial Kubernetes resources exist.
Those resources are then committed in infra with the verified image reference.
Subsequent releases update their image references through the same workflow.
No production image is published from a local checkout.

## Remaining product work

Player WebSockets, persistent sessions, provider/language administration, a PiP
window, revocable media admission, per-member Discord reception, PCM publication
and authorized shared subtitles are implemented. Live audio/provider acceptance,
native PiP/game behavior and production networking remain unfinished. A JOINING
connection cannot receive commands. Production may start with an empty language
list; the administrator later validates and enables configured paths.
See [validation](test-report.md) for local and production evidence. The web
rollout below is verified; production voice-worker deployment and live media
acceptance remain separate gates.

Verify Access, database readiness, routing, and actual rollout state separately.
Use the private infra runbook for operational credentials, backup and recovery.

## Current web release verification — 2026-10-19

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
