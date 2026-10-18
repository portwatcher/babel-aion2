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

Apply migrations through `0003_mature_the_phantom` before this web build. Readiness
checks room configuration columns, listener lifecycle columns and player socket
registrations as well as administrator tables. Migration 0003 adds room settings
without enabling a source or adding credentials. Migration 0001 preserves old rows and marks their entry fingerprints as legacy, so
they cannot be adopted by an unbound retry. Do not roll back or truncate nickname
generation/session records while old credentials could still exist.

The listener reconciler checks every 30 seconds and expires sessions with no
heartbeat for 120 seconds. Expiry revokes access first; uncertain transport
shutdown stays visible. Player WebSocket pings run every 15 seconds, allow 90
seconds without a valid pong, and renew only the authenticated current session.
Graceful shutdown closes sockets before the database pool; a physical close is
required before the socket registration is acknowledged. Hard crashes or storage
faults may leave open registrations: never clear these by age alone. Operational
recovery must first establish that the owning transport cannot deliver anymore.
This recovery tool and actual media revocation are not yet implemented. The media
adapter never grants command access. See [listener operations](listener-sessions.md).

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
4. Verify configuration versions, stopped state and administrator session behavior.
   With the original protected key, confirm that saving a retained test credential
   succeeds. Missing/wrong keys and damaged or cross-room ciphertext must fail closed.
5. Record the release, migration version, duration, and evidence before using
   the procedure for disaster recovery.

No production backup or restore was performed during scaffolding.

`NUXT_PROVIDER_ENCRYPTION_KEY` now protects saved Discord bot credentials. Generate
a 32-byte random key with `openssl rand -base64 32`; store it in the approved secret
facility, separately from the database. All web replicas need the same key.
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

Use only previously published, verified image references. An initial deployment
has no earlier deployed Babel version to restore.

These implementation checks do not establish a production rollback. Local process
restart preserves the room's stopped state, configuration version, encrypted bot
credential, administrator session and listener generations. Provider settings and
live media recovery remain separate unfinished checks.

## Logging and task cleanup

Log service state and safe error codes, never credentials, JWTs, cookies,
connection strings, full provider responses, or complete battle recordings.
The worker currently logs only its stopped state.

At task completion, stop owned preview servers and test processes and inspect
worktrees with `npm run worktree:audit`. Follow `AGENTS.md` before any removal.
Keep valuable work and unverified remote integration intact. Audit accessible
Codex chats for confirmed missing working directories and archive each match.
