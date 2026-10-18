# Listener lifecycle

Persistent transactions, HTTP operations, player WebSockets, browser restoration
and the public list are implemented. The optional media worker now provides
revocable receive-only WebRTC admission. With it configured, entry becomes ACTIVE
only after older subtitle sockets and media peers confirm closure; otherwise it
stays JOINING. Configured sources publish Discord original audio and shared member
subtitles. Live speech/provider quality still needs separate acceptance; see
[original audio](original-audio.md) and [subtitle delivery](streaming-subtitles.md).

## Entry and credentials

An explicit entry supplies a random UUID request ID, nickname, optional enabled
output language, and a 32-byte random credential encoded as unpadded base64url.
The credential is sent in `Authorization: Bearer …`; never put it in a URL.
The database stores only its SHA-256 hash, and response DTOs exclude the hash,
request fingerprint, and other private fields. Credential checks use a constant
time comparison. Player mutations require the configured same-origin `Origin`.

The request ID and credential must be reused for a retry of that entry. A changed
payload with the same request ID returns 409. A credential cannot be reused for a
different request. Retrying an old entry returns its original terminal session
without replacing a newer entry. A network retry is not a new nickname claim.
The browser saves pending requests and current credentials in per-tab
`sessionStorage` before issuing an entry request. Refresh restores the same
session; an unconfirmed entry requires an explicit retry with its saved request.
Replacement clears current access and displays the required Chinese notice.
Terminal sessions never trigger automatic entry. Explicit leave stops the local
socket first and persists the leave intention; a failed leave is retried after
refresh instead of restoring its connection. Storage failures do not trigger an
unbound entry request. The non-secret output-language preference uses `localStorage`.

The request lock is acquired first, followed by the credential lock and global
nickname row lock. One transaction creates JOINING, increments the generation,
marks the old current session REPLACED, and records the new current session.
Nickname normalization remains trimmed visible text, NFC comparison and significant
letter case. Nickname uniqueness spans rooms.

## Revocation and authorization

Transport operations run outside database transactions. Each receives the exact
session ID and nickname generation. A subtitle acknowledgement means all old
subtitle delivery has stopped and cannot reconnect. A media acknowledgement must
also mean old credentials and renewal are denied, the participant is disconnected,
and old credentials cannot rejoin. Token expiry alone is insufficient.

Only both acknowledgements record `deliveryStoppedAt`. Only the current JOINING
generation, with no older unconfirmed delivery for that nickname, may become
ACTIVE. This includes all predecessors during rapid consecutive replacements.
Transport failures retain JOINING and DISCONNECTING, never grant fallback access.

The old session retains its terminal reason, including
`DUPLICATE_NICKNAME_REPLACED`. Public lists map any terminal session with unconfirmed
shutdown to DISCONNECTING. They include JOINING before command authorization.
Manual removal, explicit leave and expiry use the same shutdown coordinator.
Administrator removal records the authenticated identity, session ID, generation
and reason, without a credential or request body.

Every 30 seconds the web process retries pending shutdowns and considers sessions
with no heartbeat for 120 seconds expired. It rechecks last-seen time under the
nickname lock, preventing a stale sweep from expiring a just-renewed session.
Sweeps do not overlap; shutdown clears the timer and waits for ongoing work.
The media worker compares actual peer registrations with current authorization
every 500 ms and closes obsolete connections. Browser heartbeats respond
to server messages instead of depending on foreground animation frames. Suspended
devices may still expire; network recovery cannot resurrect an expired session.

## Player WebSocket

`/api/player/ws` requires the configured same-origin `Origin` and a database. The
first frame must authenticate a session ID and credential within five seconds;
the credential is never included in a query string. Production requires WSS.
Only authentication and matching pong messages are accepted from a player.
Malformed frames, repeated authentication, client publication and frames larger
than 2 KiB are rejected. Outgoing connections with more than 64 KiB already
buffered are closed instead of accumulating further state. These application
checks do not replace ingress connection/message limits.

The server sends session snapshots, complete room lists, public configuration,
heartbeat challenges and bounded error codes. It polls persisted state once per
second, sends a ping every 15 seconds and closes after 90 seconds without a valid
pong. A valid pong updates the current generation's last-seen time. Authorized
subtitle frames share this channel; administrator commands use protected HTTP.

Each authenticated socket records its runtime owner in `player_connection`, under
the shared owner lock and the same nickname lock used for replacement. This prevents an old handshake from registering after
revocation has observed no sockets. Other web instances observe the terminal
session and close their sockets too. The physical close hook, not the close
request, sets `closedAt`. A slow close is force-terminated after 1.5 seconds.
Failed close persistence is retried; unconfirmed rows are never expired by TTL.
An old credential can receive its terminal snapshot but cannot register a live
connection. Media shutdown requires the independent worker's actual peer closure
receipt. A socket receipt alone cannot authorize a replacement or remove its
predecessor from the public list.

The browser reconnects only its saved session, with a capped 1–15 second backoff.
Connection-generation checks discard callbacks from obsolete sockets. Session ID
and nickname generation must match before a snapshot is accepted. Public player
lists also refresh over HTTP every five seconds while no authenticated socket is
connected; late HTTP responses cannot overwrite newer WebSocket snapshots.

Normal web shutdown stops admission and closes sockets with code 1012 before
closing PostgreSQL. A surviving supervisor observes a killed child’s OS exit and
reconciles only that incarnation’s registrations before restarting it. Same-listener
connections on other processes survive. Unknown owners after supervisor or host
loss remain unconfirmed; never turn elapsed time into a receipt. See
[process recovery](worker-recovery.md).

## HTTP API

All responses are uncached. Player session operations require that session's
credential. Administrators still require both a verified Access identity and a
matching Better Auth session. There are no administrator WebSocket operations.

| Method and route                          | Contract                                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| POST `/api/player/sessions`               | Body: `nickname`, `outputLanguage`, `requestId`; returns the session, 202 while JOINING                                   |
| GET `/api/player/sessions/:id`            | Restores the same session; terminal sessions stay terminal                                                                |
| POST `/api/player/sessions/:id/heartbeat` | Updates only the current nonterminal generation; ended sessions return 410                                                |
| PATCH `/api/player/sessions/:id/language` | Body: `outputLanguage`; refuses disabled/unvalidated codes; keeps session and audio identity                              |
| POST `/api/player/sessions/:id/media`     | Same-origin authenticated offer/answer/close for the current ACTIVE generation; see [media admission](media-admission.md) |
| DELETE `/api/player/sessions/:id`         | Explicit leave; does not delete evidence before shutdown confirmation                                                     |
| GET `/api/player/players`                 | Complete public list: session ID, nickname, entry time and connection state                                               |
| GET `/api/management/listeners`           | Protected list including generations for removal                                                                          |
| DELETE `/api/management/listeners/:id`    | Protected removal; body includes exact `nicknameGeneration`                                                               |

Language changes increment `subscriptionVersion` only when the selection changes.
That metadata will fence delayed subtitle results when subscriptions are connected;
it does not itself prove that a delivered subtitle is filtered. No language is
seeded or advertised by this change.

## Verification limits

The real PostgreSQL suite owns transaction, concurrency, idempotency and persistence
checks. Its transport port supplies controlled acknowledgements and failures; it
cannot prove actual media revocation. `npm run test:http:db` runs the built server
against loopback PostgreSQL and checks HTTP authorization, origin rejection,
replacement, public response fields, restart restoration and terminal sessions.
`npm run test:ws:db` runs two actual built Node servers, exercising origin/credential
rejection, pong renewal, cross-process replacement and physical closure, old-token
reconnect denial, forbidden publication and graceful restart recovery.
`npm run ci:local` also checks unconfigured fail-closed behavior and Access boundaries.
`npm run test:media:db` owns actual WebRTC admission, physical UDP closure,
held-acknowledgement replacement, delayed attempts, concurrent recovery and old
credential denial. Its production track is empty; it does not inject fake audio.

Chrome checks on macOS cover waiting-room entry, refresh, literal nickname display,
two-tab replacement, old-page reload without re-entry, process restart, interrupted
leave followed by refresh, and a 320px layout without horizontal overflow. Database
queries confirmed unchanged generations and the expected physical connection counts.
Browser media negotiation, mute controls, refresh, replacement and PiP's unchanged
connection count were also checked. Live sound shutdown, actual subtitles, native
PiP pixels, Discord DAVE and real-player-network tests remain NOT RUN.
