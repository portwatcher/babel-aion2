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
configuration or credentials and does not start the unfinished voice worker.

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

The package includes the scaffold and persistent waiting-room sessions. Player
WebSockets and browser replacement/recovery are implemented; Discord reception,
media transport, actual subtitle delivery, provider management and PiP remain
unfinished. A JOINING connection cannot receive battle commands. Keep the
production output-language list empty until validated processing paths and
configuration management exist. See [validation](test-report.md) for local evidence;
these changes do not establish a successful production rollout.

Verify Access, database readiness, routing, and actual rollout state separately.
Use the private infra runbook for operational credentials, backup and recovery.
