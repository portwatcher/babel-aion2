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
administrator sessions fail closed. No worker starts audio automatically.

Apply migration `0001_panoramic_mad_thinker` before this web build. Readiness now
checks the listener lifecycle columns as well as administrator tables. The
migration preserves old rows and marks their entry fingerprints as legacy, so
they cannot be adopted by an unbound retry. Do not roll back or truncate nickname
generation/session records while old credentials could still exist.

The listener reconciler checks every 30 seconds and expires sessions with no
heartbeat for 120 seconds. Expiry revokes access first; uncertain transport
shutdown stays visible. The current adapter is unavailable and never grants
command access. See [listener operations](listener-sessions.md) for the API and
remaining live transport work.

## Backup and restore procedure

For production, use the existing infra database backup method and store backups
in its approved private destination. Capture the schema migration revision,
application release, and encrypted settings together. Keep the credential recovery
key in a separate protected secret facility.

To prove restoration in an isolated environment:

1. Create a consistent PostgreSQL custom-format dump with `pg_dump` using the
   approved credential source. Do not put a production connection string in shell history.
2. Restore with `pg_restore` into a separate database; do not overwrite a running room.
3. Run readiness and the relevant database-backed tests against that database.
4. Verify configuration versions and administrator session behavior. Once provider
   encryption exists, verify that protected keys can recover a saved test credential.
5. Record the release, migration version, duration, and evidence before using
   the procedure for disaster recovery.

No production backup or restore was performed during scaffolding.

## Release rollback

Record the current image digest, Git revision, migration revision, and backup
before a production release. Roll back the image through the established infra
GitOps release method. Confirm schema compatibility first. Do not reverse a
destructive migration without an explicit data recovery plan. Verify probes,
Access boundaries, sessions, and live media after the rollback.

There is no production release to roll back yet. An application restart must
eventually preserve a stopped room, provider settings, and current generations.

## Logging and task cleanup

Log service state and safe error codes, never credentials, JWTs, cookies,
connection strings, full provider responses, or complete battle recordings.
The worker currently logs only its stopped state.

At task completion, stop owned preview servers and test processes and inspect
worktrees with `npm run worktree:audit`. Follow `AGENTS.md` before any removal.
Keep valuable work and unverified remote integration intact. Audit accessible
Codex chats for confirmed missing working directories and archive each match.
