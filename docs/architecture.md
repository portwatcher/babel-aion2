# Architecture

## Current foundation

`apps/web` uses Nuxt 4 and Nitro's Node server preset. The player page requests
only `/api/player/config` while entry is unavailable. It renders real initial
state with no sample players, language choices, or subtitles. The listener HTTP
API now persists entry, replacement, restoration, language subscription, heartbeat
and removal. Unavailable transports hold all new sessions in JOINING; a valid
entry returns 202 with a database, or 503 without database configuration.

Administration uses separate `/api/management/*` HTTP routes. Server middleware
protects those routes, `/admin` and its descendants, and `/api/auth/*`.
Each management handler repeats its required authorization check. Access proves
identity; Better Auth persists the administrator session in PostgreSQL. Status
polling uses HTTP every ten seconds. There is no administrator WebSocket.

`apps/voice-worker` is a buildable entry point that reports STOPPED and exits.
It has no Discord connection, lease, media publisher, or provider job. It must
not be deployed as a functioning audio worker.

## Shared code

`@babel/contracts` has no server dependencies. It defines nickname validation,
NFC keys, output language selection, listener states, room data, and the
language-independent subtitle payload. Interface text is independent of the
subtitle output language.

`@babel/database` uses Drizzle and `pg`. The schema contains Better Auth's four
tables, rooms, global nickname generations, listener sessions, provider
configurations, output languages, and audit events. The partial unique index
allows at most one ACTIVE session per nickname key across rooms. The schema is
backed by transactional listener operations. Request IDs bind to the original
payload and credential. Nickname rows serialize generations globally, and a new
session cannot become ACTIVE until all older deliveries have acknowledged shutdown.
The production revocation adapter remains unavailable; the database tests use
explicitly simulated transport acknowledgements. See [listener lifecycle](listener-sessions.md).

`@babel/auth` implements a Cloudflare Access Better Auth plugin. It derives a
stable administrator ID from the signed issuer and subject, saves the identity,
and creates an HTTP-only session cookie. Player listener sessions use their own
tables and are not Better Auth user accounts.

## Next implementation gates

1. Select a DAVE-compatible Discord voice library with an actual audio-receive
   test. Add exclusive guild control using the established infra method. Use
   one decoder per selected commander and bounded audio queues.
2. Select and prove a browser media transport, including old-token revocation,
   active-connection removal, and reconnect authorization. Keep entry disabled
   until revocation can be confirmed. No media SDK has been selected yet.
3. Connect the implemented idempotent entry and global nickname transactions to
   real transport revocation. The coordinator already calls revocation outside
   transactions and checks the current session/generation before authorization.
   Its periodic sweep retries removals and expires silent sessions. Actual media
   participant reconciliation and revocation proof are still required.
4. Add the player WebSocket for authorized subtitles, list updates, and terminal
   messages. Restore current sessions after refresh; never re-enter replaced
   sessions automatically. Keep an uncertain removal visible as DISCONNECTING.
5. Implement provider adapters, encrypted dynamic settings, destination
   restrictions, real connection tests, configuration versions, and audit records.
   Validate the complete processing path before enabling a language.
6. Add one shared processing path per commander and active output language,
   revision fencing, bounded queues, and independent failure recovery.
7. Add feature-detected Document PiP from a player action, sharing the same
   listener session and audio output. Test actual game display modes.
8. Complete deployment, transport, restore, rollback, and real-network evidence
   from `design.md`. Optional character lookup remains outside core delivery.

The production language list may stay empty during initial deployment. Live
audio and provider quality need their own evidence; the scaffold tests do not
establish that those paths work.
