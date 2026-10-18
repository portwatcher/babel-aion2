# Architecture

## Current foundation

`apps/web` uses Nuxt 4 and Nitro's Node server preset. The player page reads public
configuration and the complete player list, then uses HTTP for explicit entry,
restoration, language changes and leave. `/api/player/ws` carries authenticated
session, list, configuration and heartbeat events. Session credentials stay in
per-tab storage and travel in the first WebSocket frame, never in a URL. Refresh
and reconnect restore the original generation; replaced sessions never re-enter
automatically. No sample players, language choices or subtitles are generated.
Unavailable media holds all new sessions in JOINING; entry returns 202 with a
migrated database, or 503 without database configuration.

Administration uses separate `/api/management/*` HTTP routes. Server middleware
protects those routes, `/admin` and its descendants, and `/api/auth/*`.
Each management handler repeats its required authorization check. Access proves
identity; Better Auth persists the administrator session in PostgreSQL. Status
polling uses HTTP every ten seconds. There is no administrator WebSocket.
The room form saves a configuration version and encrypted Discord credential;
stale edits receive 409. Source changes persist a stopped room and advance the
source generation. The administrator list shares the player list component and
removes the selected session/generation through the revocation coordinator.
These settings do not start a worker or validate a live Discord source.
The provider editor saves disabled candidates, performs explicit connection tests,
and restores encrypted history as a new version. Candidate connection changes
must pass a probe before replacing saved settings. Database leases prevent
duplicate tests across replicas and version checks reject late results.
The audio-sample form holds two candidate test leases while Soniox recognizes
a bounded authorized PCM WAV and DeepL translates stable original utterances.
The result is restricted to the administrator and does not enable player delivery.
The term editor persists a versioned catalog with source alternatives and separate
output expressions. Sample processing reads one catalog snapshot, passes enabled
entries as provider context, and checks the catalog revision before accepting a
result. The original and translated text remain provider output.

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
configurations and their encrypted revisions, output languages, audit events and
player socket registrations.
The terminology tables use a catalog row lock to serialize edits, prevent
ambiguous aliases and make snapshots consistent. The catalog revision also supplies
entry versions, preventing version reuse after deletion/recreation. Lists are
paginated and reject obsolete page revisions. See [game terms](game-terms.md).
Room settings use a row lock and optimistic version check. Credentials use
AES-256-GCM with the room/provider ID and credential purpose as authenticated context;
read APIs expose only credential presence. See [room settings](room-configuration.md).
The partial unique index
allows at most one ACTIVE session per nickname key across rooms. The schema is
backed by transactional listener operations. Request IDs bind to the original
payload and credential. Nickname rows serialize generations globally, and a new
session cannot become ACTIVE until all older deliveries have acknowledged shutdown.
Player socket registration shares the nickname transaction lock. Only a physical
socket close acknowledges that registration, including across web replicas.
The media revocation adapter remains unavailable; database coordinator tests use
explicitly simulated media acknowledgements. Real socket tests use two Node
processes. See [listener lifecycle](listener-sessions.md).

`@babel/auth` implements a Cloudflare Access Better Auth plugin. It derives a
stable administrator ID from the signed issuer and subject, saves the identity,
and creates an HTTP-only session cookie. Player listener sessions use their own
tables and are not Better Auth user accounts.

`@babel/providers` implements bounded DeepL text requests and Soniox WebSocket
recognition with provisional/final tokens, revisions, utterance endpoints and known
sample-relative timestamps. Connection probes reuse these adapters. The sample
comparison preserves PCM pauses and translates stable utterances after recognition.
Both adapters use fixed official destinations, safe error classifications and
deadlines. Shared recognition/translation work and player subtitles remain absent.
See [provider configuration](providers-and-languages.md) for probe and sample limits.

## Next implementation gates

1. Select a DAVE-compatible Discord voice library with an actual audio-receive
   test. Add exclusive guild control using the established infra method. Use
   one decoder per selected commander and bounded audio queues.
2. Select and prove a browser media transport, including old-token revocation,
   active-connection removal, and reconnect authorization. Keep command delivery
   disabled until revocation can be confirmed. No media SDK has been selected yet.
3. Connect the implemented idempotent entry and global nickname transactions to
   real transport revocation. The coordinator already calls revocation outside
   transactions and checks the current session/generation before authorization.
   Its periodic sweep retries removals and expires silent sessions. Actual media
   participant reconciliation and revocation proof are still required.
4. Extend the player WebSocket with authorized subtitles and generation/revision
   fencing. List, terminal-state delivery, browser restoration and socket closure
   are implemented; actual subtitle traffic is not. Orphaned socket registrations
   after a hard process failure remain fail-closed and need confirmed recovery.
5. Validate the recognition and translation candidates against
   live provider credentials and authorized speech samples. Dynamic settings,
   destination restrictions, connection probes, encrypted versions and audits
   and the administrator sample comparison are implemented; connection success
   alone does not validate a subtitle path or speech quality.
   Add language-path configuration and validation before enabling any language.
6. Add one shared processing path per commander and active output language,
   revision fencing, bounded queues, and independent failure recovery.
7. Add feature-detected Document PiP from a player action, sharing the same
   listener session and audio output. Test actual game display modes.
8. Complete deployment, transport, restore, rollback, and real-network evidence
   from `design.md`. Optional character lookup remains outside core delivery.

The production language list may stay empty during initial deployment. Live
audio and provider quality need their own evidence; the scaffold tests do not
establish that those paths work.
