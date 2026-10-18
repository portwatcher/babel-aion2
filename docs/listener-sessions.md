# Listener lifecycle

Implemented on 2026-10-18: persistent session transactions and HTTP operations.
Discord, media and the player WebSocket are not connected. Browser entry remains
disabled, and the production coordinator cannot authorize a listener. This is
progress toward design.md sections 6–9, not proof of end-to-end replacement.

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
The scaffold entry control now retains its request ID and credential between
retries within that mounted component. Browser refresh storage, terminal-state
rendering, and the complete listening interface remain to be implemented.

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
There is no actual-media participant comparison yet. Background-tab heartbeat
delivery must be proven with the future WebSocket before enabling browser entry.

## HTTP API

All responses are uncached. Player session operations require that session's
credential. Administrators still require both a verified Access identity and a
matching Better Auth session. There are no administrator WebSocket operations.

| Method and route                          | Contract                                                                                     |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| POST `/api/player/sessions`               | Body: `nickname`, `outputLanguage`, `requestId`; returns the session, 202 while JOINING      |
| GET `/api/player/sessions/:id`            | Restores the same session; terminal sessions stay terminal                                   |
| POST `/api/player/sessions/:id/heartbeat` | Updates only the current nonterminal generation; ended sessions return 410                   |
| PATCH `/api/player/sessions/:id/language` | Body: `outputLanguage`; refuses disabled/unvalidated codes; keeps session and audio identity |
| DELETE `/api/player/sessions/:id`         | Explicit leave; does not delete evidence before shutdown confirmation                        |
| GET `/api/player/players`                 | Complete public list: session ID, nickname, entry time and connection state                  |
| GET `/api/management/listeners`           | Protected list including generations for removal                                             |
| DELETE `/api/management/listeners/:id`    | Protected removal; body includes exact `nicknameGeneration`                                  |

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
`npm run ci:local` also checks unconfigured fail-closed behavior and Access boundaries.

Live old-token reconnect, websocket termination, browser sound shutdown, PiP,
Discord DAVE and real-network tests remain NOT RUN. Do not enable the transport
adapter or set `entryAvailable` true on the strength of these simulated receipts.
