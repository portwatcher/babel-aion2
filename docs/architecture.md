# Architecture

## Current foundation

`apps/web` uses Nuxt 4 and Nitro's Node server preset. The player page reads public
configuration and the complete player list, then uses HTTP for explicit entry,
restoration, language changes and leave. `/api/player/ws` carries authenticated
session, list, configuration and heartbeat events. Session credentials stay in
per-tab storage and travel in the first WebSocket frame, never in a URL. Refresh
and reconnect restore the original generation; replaced sessions never re-enter
automatically. No sample players, language choices or subtitles are generated.
A player action can open a feature-detected Document PiP window. Vue Teleport
shares the existing listener's reactive status and text size with that document;
there is no extra network client, session or media element. Session replacement,
leave, page navigation and listener-component disposal close the window. Actual
subtitle content still needs the authorized delivery path described below.
Without the optional private media worker, new sessions remain JOINING and entry
returns 202. A configured worker can authorize the current listener after older
socket and media closures are confirmed. The browser opens one receive-only peer
and owns its playback/mute control; PiP adds no audio element. Entry returns 503
without database configuration. No live Discord source is connected.

Administration uses separate `/api/management/*` HTTP routes. Server middleware
protects those routes, `/admin` and its descendants, and `/api/auth/*`.
Each management handler repeats its required authorization check. Access proves
identity; Better Auth persists the administrator session in PostgreSQL. Status
polling uses HTTP every ten seconds. There is no administrator WebSocket.
The room form saves a configuration version and encrypted Discord credential;
stale edits receive 409. Source changes persist a stopped room and advance the
source generation. The administrator list shares the player list component and
removes the selected session/generation through the revocation coordinator.
Capture scope is either selected member IDs or all channel speakers. Existing
rooms retain selected mode; switching scope advances the source generation and
persists stopped state. These settings do not start Discord reception or validate
a live source. All-channel speaker discovery remains part of the Discord gate.
The provider editor saves disabled candidates, performs explicit connection tests,
and restores encrypted history as a new version. Candidate connection changes
must pass a probe before replacing saved settings. Database leases prevent
duplicate tests across replicas and version checks reject late results.
The audio-sample form holds two candidate test leases while Soniox recognizes
a bounded authorized PCM WAV and DeepL translates current utterance revisions.
The result is restricted to the administrator and does not enable player delivery.
The term editor persists a versioned catalog with source alternatives and separate
output expressions. Sample processing reads one catalog snapshot, passes enabled
entries as provider context, and checks the catalog revision before accepting a
result. The original and translated text remain provider output.
The output-language editor stores provider references, terminology policy, order
and a room default. Sample validation binds to the path and provider/catalog
revisions; stale results cannot validate a replacement path. Last successful
proofs and latest attempts are separate. Activation remains unavailable until
the worker-to-player path exists. See [output languages](output-languages.md).

`apps/voice-worker` implements authenticated private media control and Werift
0.25.1 receive-only admission. It rechecks persisted listener authorization,
registers negotiations before creating peers, closes obsolete peers and persists
the actual close acknowledgement. It has no Discord connection, exclusive guild
lease, PCM publisher or provider job. Readiness reports audio STOPPED even when
media admission is available. See [media admission](media-admission.md).

## Shared code

`@babel/contracts` has no server dependencies. It defines nickname validation,
NFC keys, output language selection, listener states, room data, and the
language-independent subtitle payload. Interface text is independent of the
subtitle output language.

`@babel/database` uses Drizzle and `pg`. The schema contains Better Auth's four
tables, rooms, global nickname generations, listener sessions, provider
configurations and their encrypted revisions, output languages, audit events and
player socket and media connection registrations.
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
Media registrations share that same lock and use monotonically increasing
negotiation attempts within a listener generation. Only the owning worker records
closure after initialization, answer processing and actual peer close settle.
Database coordinator tests use controlled transport receipts; the separate media
suite proves actual WebRTC and OS UDP socket release across two web processes.
See [listener lifecycle](listener-sessions.md).

`@babel/auth` implements a Cloudflare Access Better Auth plugin. It derives a
stable administrator ID from the signed issuer and subject, saves the identity,
and creates an HTTP-only session cookie. Player listener sessions use their own
tables and are not Better Auth user accounts.

`@babel/providers` implements bounded DeepL text requests and Soniox WebSocket
recognition with provisional/final tokens, revisions, utterance endpoints and known
sample-relative timestamps. Connection probes reuse these adapters. The sample
comparison preserves PCM pauses and uses the shared streaming engine to translate
while recognition continues. The engine shares recognition per source and
translation work per output language, bounds pending revisions, cancels obsolete
requests and releases unused lanes. Both adapters use fixed official destinations,
safe error classifications and deadlines. The Discord worker and authorized
player delivery are not yet connected to the engine; player subtitles remain
unavailable. See [streaming processing](streaming-subtitles.md).
See [provider configuration](providers-and-languages.md) for probe and sample limits.

## Next implementation gates

1. Select a DAVE-compatible Discord voice library with an actual audio-receive
   test. Add exclusive guild control using the established infra method. Use
   one decoder per selected speaker and bounded audio queues, with automatic
   membership/speaker discovery in all-channel mode.
2. Add decoded PCM publication independently from subtitle work, with source
   fencing and actual-network proof. Werift passes local synthetic decoding and
   application admission/closure checks on macOS and Linux arm64; these do not
   establish commander audio, TURN, Linux amd64 or capacity. See the
   [candidate evidence](media-compatibility.md).
3. Implement confirmed recovery of orphan media registrations after hard crashes
   and worker routing before scaling beyond one configured control endpoint.
   Current revocation observes actual peers and old credentials are denied, but
   unknown owners remain fail-closed. Graceful restart preserves listener identity.
4. Extend the player WebSocket with authorized subtitles and generation/revision
   fencing. List, terminal-state delivery, browser restoration and socket closure
   are implemented; actual subtitle traffic is not. Orphaned socket registrations
   after a hard process failure remain fail-closed and need confirmed recovery.
5. Validate the recognition and translation candidates against
   live provider credentials and authorized speech samples. Dynamic settings,
   destination restrictions, connection probes, encrypted versions and audits
   and the administrator sample comparison are implemented; connection success
   alone does not validate a subtitle path or speech quality.
   Language-path configuration and persisted sample validation are implemented;
   live provider evidence and authorized delivery are still required for activation.
6. Connect the shared processing engine to the Discord worker and actual
   language demand, with source-generation fencing and independent reconnects.
   Runtime revision fencing, bounded translation queues and unused-stream release
   are implemented and exercised by the sample path and local protocol tests.
7. Connect real subtitle content to the implemented Document PiP status window.
   Verify its native rendering, background updates, single audio output and actual
   game display modes. See [PiP scope and evidence](picture-in-picture.md).
8. Complete deployment, transport, restore, rollback, and real-network evidence
   from `design.md`. Optional character lookup remains outside core delivery.

The production language list may stay empty during initial deployment. Live
audio and provider quality need their own evidence; the scaffold tests do not
establish that those paths work.
