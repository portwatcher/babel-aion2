# Architecture

## Community rooms and tactical map

`/` lists only installed community rooms. Room creation uses a short-lived,
HTTP-only browser binding and one-use OAuth2 state; Discord's token response
supplies the guild identity. User guild permissions and effective bot channel
permissions are verified before a transaction creates the room, its admission
policy and an audit event. A guild lock prevents duplicate rooms; retries return
the original creation. Shared bot credentials use the existing room-bound cipher.

Room-specific entry checks the immutable server/allowlist and then AION2 Index's
fixed public search endpoint. The returned exact character ID is the display
name. Community nickname keys include the room UUID; legacy default-room keys
retain compatibility. Session storage is scoped by tab and room. Player lists,
configuration and voice sources use the listener's actual room. Discord voice
state handling ignores other guilds and voice adapters use room-specific groups.

The client loads Leaflet only on room pages. Original public tiles span zoom 0–7;
map-space coordinates are shared by rendering, freehand input and eraser hit tests.
Authenticated map polling repairs the full snapshot every two seconds. Writes
share nickname locks with revocation and a room lock for bounded, idempotent
insertion. Author metadata is derived from the session. Reads and writes reject
old generations and cross-room credentials. Only the original session can delete
its stroke. PostgreSQL provides persistence and cross-replica synchronization.

See [multi-room setup, upstream dependencies and limits](multi-room-and-map.md).

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
leave, page navigation and listener-component disposal close the window. Current
member subtitles arrive through the same authorized socket and shared view state.
Without the optional private media worker, new sessions remain JOINING and entry
returns 202. A configured worker can authorize the current listener after older
socket and media closures are confirmed. The browser opens one receive-only peer
and owns its playback/mute control; PiP adds no audio element. Entry returns 503
without database configuration. A separately configured and started Discord
source supplies original audio and independently feeds per-member recognition.

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
persists stopped state. The separate start action requests reception and source
status is polled every three seconds. All-channel discovery uses speaking member
IDs and independent decoders; a saved configuration is not live audio proof.
The provider editor saves disabled candidates, performs explicit connection tests,
and restores encrypted history as a new version. Candidate connection changes
must pass a probe before replacing saved settings. Database leases prevent
duplicate tests across replicas and version checks reject late results.
The audio-sample form holds the selected OpenAI configuration lease while a
bounded authorized PCM WAV feeds original-caption recognition and direct-audio
translation concurrently. Finite samples return their comparison after draining;
player captions publish each fragment. The catalog's enabled source terms become
recognition hints. Target expressions remain evaluation data because the realtime
translator does not support custom prompts/glossaries. Independent source and
translation streams are labeled accordingly; timestamps are not fabricated.
The output-language editor stores provider references, terminology policy, order
and a room default. Sample validation binds to the path and provider/catalog
revisions; stale results cannot validate a replacement path. Last successful
proofs and latest attempts are separate. Activation requires current proof and
private worker readiness. See [output languages](output-languages.md).

`apps/voice-worker` implements authenticated private media control and Werift
0.25.1 receive-only admission. It rechecks persisted listener authorization,
registers negotiations before creating peers, closes obsolete peers and persists
the actual close acknowledgement. A PostgreSQL ownership session and durable
source receipt exclude duplicate bot/guild controllers. The source controller
connects Discord with DAVE, maintains separate member decoders and bounded PCM
queues, and publishes mixed original audio independently of subtitle work. Source
retirement closes old browser peers before acknowledging shutdown. Separate
member timelines feed shared provider jobs only while language demand exists.
Version-checked private HTTP streams feed actual registered player sockets.
See [original audio](original-audio.md) and
[media admission](media-admission.md).
Explicit [STUN/TURN configuration](media-network.md) issues separate temporary
worker/browser relay credentials. Expiry and renewal use existing media attempts;
the worker acknowledges closure only after the actual peer stops.
Web and voice entry points share `@babel/processes`. A supervisor acknowledges
only its own child’s confirmed OS exit. Shared owner locks fence delayed player,
media and source registration; storage failure blocks restart until the receipt
commits. See [process recovery](worker-recovery.md).
Kubernetes runtimes also bind owners to Pod identity. A private recovery
controller seals new admission and confirms scoped closure from actual terminal
container evidence; missing/unknown hosts remain blocked. See
[Kubernetes recovery](kubernetes-recovery.md).

## Interface localization

Each Nuxt request installs its own Vue I18n instance, following the Perohub
frontend pattern. A saved interface cookie takes precedence over weighted
Accept-Language detection, with English as the fallback. Nuxt serializes the
initial locale for consistent hydration. After mounting, valid localStorage
preferences take precedence and repair the SSR cookie. The header selector
updates both stores and the reactive locale without re-entering the room.
Player copy, validation, status, PiP and error pages use four typed catalogs.
Administrator routes force English, including shared components and error pages,
while preserving the player preference. HTML varies on Accept-Language and Cookie.
See [interface localization](interface-localization.md).

## Shared code

`@babel/contracts` has no server dependencies. It defines nickname validation,
NFC keys, output language selection, listener states, room data, and the
language-independent subtitle payload. Interface text is independent of the
subtitle output language.

`@babel/database` uses Drizzle and `pg`. The schema contains Better Auth's four
tables, rooms, global nickname generations, listener sessions, provider
configurations and their encrypted revisions, output languages, audit events and
player socket, media connection and voice-source ownership registrations.
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
payload and credential. Legacy nickname rows serialize generations globally; community keys serialize
within each room. Publication of the original room also fences legacy same-ID
delivery while changing namespaces. A new
session cannot become ACTIVE until all older deliveries have acknowledged shutdown.
Player socket registration shares the nickname transaction lock. Only a physical
socket close acknowledges that registration, including across web replicas.
Media registrations share that same lock and use monotonically increasing
negotiation attempts within a listener generation. Only the owning worker records
closure after initialization, answer processing and actual peer close settle;
its supervisor may also reconcile that incarnation after confirmed OS exit.
Database coordinator tests use controlled transport receipts; the separate media
suite proves actual WebRTC and OS UDP socket release across two web processes.
See [listener lifecycle](listener-sessions.md).

`@babel/auth` implements a Cloudflare Access Better Auth plugin. It derives a
stable administrator ID from the signed issuer and subject, saves the identity,
and creates an HTTP-only session cookie. Player listener sessions use their own
tables and are not Better Auth user accounts.

`@babel/providers` implements `gpt-live-transcribe` with minimal delay and one
`gpt-realtime-translate` continuous audio session per active target language.
Audio fans out in parallel, without serial transcript-to-translation requests.
Every target delta publishes immediately. Recognition and targets share one
server-only encrypted key, fixed official destinations, bounded socket/audio
queues and safe errors. Current listener/source/configuration checks run in one
database round trip before delivery and fence obsolete work. Main page and PiP
consume the same incremental state. See [streaming processing](streaming-subtitles.md).
See [provider configuration](providers-and-languages.md) for probe and sample limits.

## Next implementation gates

1. Complete application live-audio acceptance with simultaneous speakers,
   member re-entry, DAVE changes and configured Linux targets. Single-member
   isolated receipt and rejoin are proven; per-member decoding, bounded mixing
   and exclusive source control are implemented.
2. Complete player-network and performance acceptance. Production public TURN
   routing and single-member audible playback pass; native AMD64 throughput,
   restricted networks, background/game behavior and capacity remain unmeasured.
   Local Coturn UDP/TCP/TLS and credential expiry pass separate checks. See the
   [candidate evidence](media-compatibility.md).
3. Complete production confirmation of Kubernetes container recovery, independent
   fencing for hosts whose termination remains unknown, and worker routing before
   scaling beyond one configured control endpoint. Local whole-container crashes
   now recover from verified kubelet receipts while preserving listener identity.
   The controller is deployed with confirmed Pod binding, scoped permissions and
   a healthy rollout; abrupt production failure is not covered by that check.
4. Complete legacy/unknown-host player-owner reconciliation and live background
   recovery acceptance. Local child and container crashes recover through scoped
   receipts; other live web connections survive. Unknown owners remain fail-closed.
5. Validate the recognition and translation candidates against
   live provider credentials and authorized speech samples. Dynamic settings,
   destination restrictions, connection probes, encrypted versions and audits
   and the administrator sample comparison are implemented; connection success
   alone does not validate a subtitle path or speech quality.
   Language-path configuration and persisted sample validation are implemented;
   authorized delivery is implemented, but live provider quality remains unproven.
6. Measure the integrated per-member recognition/translation path under real
   provider limits, concurrency and recovery. Loopback transport proves sharing,
   source/provider replacement and unused release; it does not prove live latency.
7. Verify native PiP rendering, background updates and actual game display modes
   with live speech. Main-page and PiP subtitle content share state and one media
   output. See [PiP scope and evidence](picture-in-picture.md).
8. Complete remaining production recovery and real-network evidence from
   `design.md`. Web/voice deployment, single-member audible delivery, isolated
   database restoration and published-image rollback rehearsal have passed;
   those checks do not establish multiple-member acceptance or disaster recovery.
   Optional character lookup remains disabled because the source's published
   crawler policy excludes its search and API paths. See the
   [source probe](test-report.md#optional-character-source-probe--2026-10-19).

The production language list may stay empty during initial deployment. Live
audio and provider quality need their own evidence; the scaffold tests do not
establish that those paths work.
