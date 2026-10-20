# Operations

## Local database

`npm run db:up` starts PostgreSQL 16 on loopback port 55432. `npm run db:down`
stops it and retains `babel-local_postgres-data`. Credentials in `.env.example`
are local-only. `npm run db:migrate` applies committed Drizzle migrations;
running it again is safe. `npm run db:generate` creates migrations from schema
changes and requires review before committing.

The app opens its PostgreSQL pool on the first database operation or configured
listener reconciliation sweep and closes it on server shutdown.
Without database configuration the public lobby stays available; readiness and
administrator sessions fail closed. An unconfigured worker starts no audio;
a configured running room reconnects after a normal worker restart.

Apply migrations through `0012_parallel_toad` before this web build. Web readiness
checks room configuration columns, listener lifecycle columns and player socket
registrations, provider test/history columns, terminology tables, the initialized
catalog revisions, output-language validation columns and administrator tables. Migration
0004 adds provider history and test leases without enabling a provider or language.
Migration 0005 adds the empty terminology catalog and game-term table. Include both
tables in the same database backup; catalog and entry versions must be restored
together. No production term vocabulary is initialized.
Migration 0006 adds language versions, sample proof/attempt metadata and the global
language catalog; it normalizes existing ordering without enabling or adding
languages. Back up language/catalog rows, room defaults, provider revisions and
terminology versions consistently. A restored proof is current only when all
referenced versions still match. See [output languages](output-languages.md).
Migration 0007 adds media connection owners, listener generations, negotiation
attempts and physical-close receipts. Worker readiness checks this schema.
Preserve these records consistently with listener and nickname records; do not
clear a registration until its owning transport is confirmed stopped.
Migration 0008 adds the capture-mode enum and preserves selected-member scope on
existing rooms. Readiness checks this column; a previous schema returns 503.
Migration 0009 adds exclusive source ownership and durable close receipts.
The receiving worker holds one dedicated PostgreSQL ownership session for all
of its sources; loss of
that session fences playback and subtitles. Unconfirmed ownership cannot be
cleared merely because its heartbeat is old. See [original audio](original-audio.md).
Migrations 0010 and 0011 add runtime ownership and indexed nullable player owners.
Existing unknown registrations are not assigned an invented process identity.
Migration 0012 adds Pod admission barriers and optional runtime-to-Pod ownership.
See [Kubernetes recovery](kubernetes-recovery.md) for verified container retirement
and the private controller's permissions, rollout order and failure limits.
See [process recovery](worker-recovery.md) before replacing older runtimes.
Migration 0003 adds room settings
without enabling a source or adding credentials. Migration 0001 preserves old rows and marks their entry fingerprints as legacy, so
they cannot be adopted by an unbound retry. Do not roll back or truncate nickname
generation/session records while old credentials could still exist.

The listener reconciler checks every 30 seconds and expires sessions with no
heartbeat for 120 seconds. Expiry revokes access first; uncertain transport
shutdown stays visible. Player WebSocket pings run every 15 seconds, allow 90
seconds without a valid pong, and renew only the authenticated current session.
Graceful shutdown closes sockets before the database pool; a physical close is
required before the socket registration is acknowledged. Hard crashes or storage
faults may leave open registrations: never clear these by age alone. Web and voice
supervisors reconcile their own child’s confirmed OS exit before restarting it;
the Kubernetes controller also accepts verified terminal-container evidence for
Pod-bound owners. Unknown host owners still need independent fencing evidence.
See [process recovery](worker-recovery.md) for supported entry points, migrations
and readiness. The optional media worker now
closes actual peers and confirms them before replacement; configured sources
carry Discord original audio and independent subtitles. Graceful media restart
is tested. See [media admission](media-admission.md)
and [listener operations](listener-sessions.md).

## Database connection budget

`NUXT_DATABASE_POOL_MAX` limits each web runtime's pool; it is a positive integer
with a default of 10. `DATABASE_POOL_MAX` limits each of the worker's three
independent pools (media, source control and subtitles); it defaults to 10 and
must be at least 2. Source control holds one dedicated PostgreSQL session for
all of its sources while other queries continue, so two connections support any
number of rooms. Each supervisor has a separate fixed one-connection pool.

## Media capacity

`MEDIA_WORKER_THREADS` (0–16, default 2) sets the worker threads that own WebRTC
peers. `MEDIA_OPUS_FRAME_MS` (20, 40 or 60; default 60) sets the original-audio
packet duration. See [listener capacity](capacity.md) for measurements and the
CPU, TURN relay-port and bandwidth requirements of 1,000 listeners.

For W web processes and V voice processes, plan for at most
`W × (web pool + 1) + V × (3 × worker pool + 1)` application connections. Include
one connection per recovery-controller process, including rollout overlap. Include
old and new processes overlapping during rollout, then reserve additional
connections for migrations and operations. Set both limits in private runtime
configuration to fit the database role and server budgets. Defaults preserve the
previous runtime pool sizes; they are not a production capacity recommendation.

Zero, fractional and nonnumeric settings fail configured production startup.
Requests queue when a pool is full, subject to the existing connection-acquisition
deadline. Provider/subtitle work retains its own pool so it cannot consume all
media/source slots. These settings do not replace database authorization or the
existing fail-closed transport checks.

After a build, `npm run test:pools:db` uses an isolated local database and real
web/worker processes. PostgreSQL table locks hold concurrent HTTP work while the
test measures actual database sessions, then verifies that queued requests resume
and shutdown releases those sessions. It also exercises invalid startup settings.
This is a connection-budget regression, not a user-capacity benchmark.

## Backup and restore procedure

For production, use the existing infra database backup method and store backups
in its approved private destination. Capture the schema migration revision,
application release, and encrypted settings together. Keep the credential recovery
key in a separate protected secret facility.

To prove restoration in an isolated environment:

1. Create a consistent PostgreSQL custom-format dump with `pg_dump` using the
   approved credential source. Do not put a production connection string in shell history.
2. Restore with `pg_restore` into a separate database; do not overwrite a running room.
   Keep it outside public routing and leave voice workers stopped during inspection.
3. Run readiness and the relevant database-backed tests against that database.
4. Verify configuration versions, stopped state and administrator session behavior.
   With the original protected key, confirm that saving a retained test credential
   succeeds. Missing/wrong keys and damaged or cross-room ciphertext must fail closed.
5. Record the release, migration version, duration, and evidence before using
   the procedure for disaster recovery.

Restoration does not provide transport-close evidence. A backup taken before a
socket closes still contains its unconfirmed owner/receipt after restoration,
even if the original database later recorded the close. Those rows must remain
fail-closed until independent physical shutdown evidence is available. Do not
clear them by age or mark them closed merely because a dump was restored.
Also account for revocations written after the snapshot: a point-in-time backup
does not contain that later history. Production recovery must fence the old
services and outstanding credentials before exposing the restored application.
Supervisor/host recovery and production disaster-recovery coordination remain
unfinished; neither the local fixture nor isolated production-snapshot restoration
establishes those paths.

`npm run test:restore:db` rehearses real custom-format dumps and restores using
only generated local fixture data. It creates its own source and destination
databases. Host `pg_dump`/`pg_restore` must match the server major version. For the
local Compose service, use its matching tools instead:

```sh
BABEL_TEST_POSTGRES_CONTAINER=babel-local-postgres-1 npm run test:restore:db
```

The named container must be the disposable PostgreSQL service referenced by
`DATABASE_URL`. Credentials pass through process environment, not command-line
arguments. Custom-format dumps are mode 0600 in an ignored private temporary
directory and are removed afterward. This test is not a production backup tool
or encrypted backup-storage implementation.
The fixture restores with ownership/ACL changes omitted into a database owned by
its local test user. Production roles, grants and backup retention remain the
private infra procedure's responsibility and need separate verification.

The fixture exports one PostgreSQL snapshot for both the dump and independent
table digests. It verifies all application/migration tables after restore, repeats
migration safely, then starts the actual application. Checks include saved
administrator sessions with mandatory Access, stopped rooms, encrypted room and
provider settings/history, terminology and language validation revisions, and
denial of a previously ended listener. A separate running-state snapshot retains
an unconfirmed player receipt: nickname replacement stays JOINING while an
unrelated nickname becomes ACTIVE. See [validation](test-report.md) for tested
PostgreSQL versions. This command uses generated fixture data rather than a
production backup.

Private infra also provides `babel-restore-rehearsal.mjs`, exercised against a
read-only production snapshot on 2026-10-19. It uses the deployed database and web
image digests, restores into an isolated local Docker database, checks all 20
application/migration tables and schema, repeats migrations and starts the actual
web runtime without a voice worker. The existing key decrypts the restored room
credential; a wrong key is rejected. Restored unknown owners and transport receipts
remain unconfirmed, including the current release's Pod ownership records and
13 migration entries. See the [production snapshot report](test-report.md#production-snapshot-restoration--2026-10-19).

Run that command from private infra using its documented Kubernetes access and
local Docker prerequisites. Restore destinations are created by the tool, not
supplied as connection URLs. It stores only an AES-256-GCM-encrypted temporary
dump on disk, keeps its one-use backup key in memory and removes both the archive
and temporary registry configuration afterward. It is a restore rehearsal, not a
backup retention service. Keep a durable backup and its separate recovery key in
approved protected storage for actual recovery; production roles/grants,
old-service fencing and later revocations still need the production recovery plan.

`NUXT_PROVIDER_ENCRYPTION_KEY` protects saved Discord bot credentials and current
and historical provider credentials. Generate
a 32-byte random key with `openssl rand -base64 32`; store it in the approved secret
facility, separately from the database. All web replicas need the same key;
the worker uses that value as `PROVIDER_ENCRYPTION_KEY`.
Changing this key does not re-encrypt saved data: retain the original key for
recovery. A general re-key procedure is not implemented. A valid administrator
can replace or remove an unreadable bot credential explicitly, but a normal save
that retains it fails. No read or export operation returns its plaintext.

## Release rollback

Record the current image digest, Git revision, migration revision, and backup
before a production release. Roll back the image through the established infra
GitOps release method. Confirm schema compatibility first. Do not reverse a
destructive migration without an explicit data recovery plan. Verify probes,
Access boundaries, sessions, and live media after the rollback.

Use only previously published, verified image references. The earlier scaffold
does not implement the current listener and configuration features. A downgrade
to that version requires stopped command delivery and an explicit plan to return
to the current version; database compatibility alone does not preserve features.
Likewise, a release before Pod admission cannot safely replace an active managed
runtime. Stop and confirm all web/voice delivery, resolve outstanding retirement
requests, and retain the compatible recovery controller through that transition.
Do not clear unknown owners or remove finalizers to force a downgrade. See
[Pod recovery limits](kubernetes-recovery.md#private-deployment).

Before a rollout, pull the previous and candidate published images using the
approved registry access method. Keep registry credentials outside this repository.
Set `BABEL_ROLLBACK_PREVIOUS_IMAGE` and `BABEL_ROLLBACK_CURRENT_IMAGE` to their
immutable `@sha256:` references and run `npm run test:rollback:images`. Images
must already be local and contain the release source-revision label. Docker is
required. `BABEL_TEST_POSTGRES_IMAGE` selects the disposable database image and
defaults to `postgres:13-alpine`; match the production server major.

This command generates its own database credentials and does not load `.env`.
It creates a disposable database owned by a non-superuser role, uses each image's
own migration runner and starts the unmodified web entry points as UID 1000 with
a read-only filesystem and dropped capabilities. It exercises the previous
release, upgrade, rollback and forward recovery. Signed test Access assertions
are supplied by the existing test-process JWKS preload; there is no production
authentication bypass. The original administrator cookie must work across the
sequence, while assertion-only, cookie-only and forged-assertion requests fail.

The check compares all business/migration table digests across rollback, excluding
process-owner rows that legitimately change at startup and shutdown. It also reads
saved room and terminology settings through the application after forward recovery
and retains the encrypted room credential through a normal save. It starts no
Discord connection, seeds no production data and removes its containers and
temporary database storage. Exact-image functional checks on an emulated CPU are
not a native capacity measurement.
The current recovery release and its preceding production web image pass this
sequence with 12-to-13 migration compatibility. That Docker check supplies no Pod
identity and therefore covers the post-drain web/database sequence only; see
[published-image evidence](test-report.md#published-image-rollback-compatibility--2026-10-19).

These implementation checks do not establish a production GitOps rollback or
live media recovery. Local process
restart preserves the room's stopped state, configuration version, encrypted bot
credential, administrator session and listener generations. Separate built-server
checks also preserve provider versions and encrypted history across processes.
Restoring a provider's historical version is re-tested before saving a new version;
this is not a deployment rollback or proof of live media recovery.

## Logging and task cleanup

Log service state and safe error codes, never credentials, JWTs, cookies,
connection strings, full provider responses, or complete battle recordings.
The worker logs only controlled startup state, its listening port and safe
configuration/startup errors. Management reads actual Discord state and member
frame counters through the authenticated private worker API. Subtitle readiness
checks the private service, database and key configuration; it does not establish
provider quality. Subtitle traffic uses bounded private HTTP streams attached to
registered player sockets. Source and provider failures discard obsolete work;
audio, transcripts and translated text are not persisted. See
[shared processing and delivery limits](streaming-subtitles.md).
Administrator audio-sample comparisons hold both provider test slots for at most
the 35-second lease, with a 30-second processing deadline and the existing test
cooldown. A crashed process releases its slots through lease expiry. Sample
requests and results are not durable jobs: a page reload loses the comparison.
Audits retain only candidate IDs/versions and safe result codes; do not add audio
or transcript logging when investigating a sample failure. See the
[sample format and provider scope](providers-and-languages.md#audio-sample-comparison).

At task completion, stop owned preview servers and test processes and inspect
worktrees with `npm run worktree:audit`. Follow `AGENTS.md` before any removal.
Keep valuable work and unverified remote integration intact. Audit accessible
Codex chats for confirmed missing working directories and archive each match.
