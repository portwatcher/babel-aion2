# Babel · AION2 深渊战

Nuxt 4 + Better Auth + PostgreSQL project scaffold for AION2 Steam Global / Asia.
Repository: [portwatcher/babel-aion2](https://github.com/portwatcher/babel-aion2),
private today and prepared for eventual open source.
The player interface is a dark, low-distraction battle panel. The original
requirements are kept in sync in [design.md](design.md) and [GOAL.md](GOAL.md).

Create a room with one of two audio sources. **Host capture** needs no
Discord: enter the host character ID; after joining, that character chooses what
to broadcast (computer audio or any audio input) and can switch it in the room. See [player audio source](docs/player-audio-source.md).
**Discord** creates rooms by installing the bot. Server identity comes from
the OAuth grant. The same Discord server can host multiple independent rooms;
they share one voice-channel audio receiver. No administrator room setup is
required. Rooms use increasing numbers from 1, such as `/rooms/1`. Share
`/rooms/:roomNumber` to join directly; without a valid room session,
players first visit character verification and return to that room after passing.
Community rooms automatically disband after five continuous minutes empty, from
creation or confirmed last-listener shutdown. The server checks every 30 seconds;
joining cancels expiry. Disbanded rooms leave the directory and reject further entry.
See [community rooms](docs/multi-room-and-map.md).

The player interface supports English, Simplified Chinese, Japanese and Korean.
It detects browser preferences during SSR and falls back to English. The compact
header selector overrides detection; its choice is stored in localStorage and
mirrored in a cookie for subsequent server rendering. Administration always uses
English and contains only the website-wide OpenAI API Key and game terms.
Room creation handles the audio source; administration does not select or
manage individual rooms. Interface language does not change the selected subtitle language or
listener session. See [interface localization](docs/interface-localization.md).

The website and private voice worker are deployed at
[babel.juryquinn.com](https://babel.juryquinn.com/); a real browser relay connection
is verified. The production Discord source is configured in all-channel mode and
has decoded one real member's audio, which the human confirmed hearing through
the production webpage. Multiple-speaker acceptance remains unfinished. The
[current acceptance status](docs/test-report.md#current-acceptance-status--2026-10-19)
separates shipped web behavior, local proofs and outstanding live checks.
Production Chrome also passed nickname replacement, same-session refresh,
administrator removal, subtitle-window closure and recovery after a graceful
worker restart. A cross-node relay routing failure found during that restart
was corrected in private infra.
The private Pod-recovery controller is also deployed. Isolated whole-container
crashes recover with confirmed termination evidence; the production rollout kept
room settings and listener identity, with a temporary Discord reconnect delay.

Listener storage, HTTP operations and player WebSockets implement atomic global
nickname replacement, idempotent entry, browser restoration, language subscription
metadata, removal and reconciliation. The browser preserves its current session
across refresh/reconnection and stops after replacement. A feature-detected
Document PiP window shares the page's current subtitle/connection status and text
size; it does not open another listener session or media connection. The optional
media worker now authorizes receive-only WebRTC and confirms actual peer closure
before replacement. A configured Discord source now decodes each speaker
independently and publishes mixed original audio to that room. Each member's PCM
also feeds shared recognition and language-specific translation, delivered through
the existing authenticated player socket to the page and PiP. Live provider quality
and production-network acceptance remain unfinished.
Explicit STUN/TURN settings support temporary relay credentials and browser renewal
within the same listener. Public relay connectivity has its own deployment proof;
restricted player networks, capacity and real speech remain separate checks.
Administrators can save versioned room/Discord settings, protect the bot credential
with server-side encryption, persist a stopped room, and remove a specific listener
generation. Saving a changed source stops it; the separate start action requests
connection and the page polls actual worker status.
Discord scope can be either selected member IDs or all speaking members of the
configured channel. All-channel mode requires no prefilled commander IDs;
the worker discovers speakers by Discord user ID and shows received frame counts.
The administrator saves only one encrypted OpenAI API Key. Fixed server adapters
use `gpt-live-transcribe` for original captions and `gpt-realtime-translate` for
parallel direct-audio translation. Every translated fragment is pushed immediately
to the page and PiP; translation never waits for a completed source transcript.
Only languages with current subtitle subscribers open translation sessions. The
last unsubscribe closes that target immediately; no listeners releases recognition
too, while original audio continues independently.
An authorized PCM WAV sample can verify a selected language path. Game terms
can guide original-caption recognition; the realtime translation API does not
support custom glossaries. Original and translated streams are independent.
Administrators can prepare output-language paths, order them, choose a default,
and save sample validation tied to the exact provider and terminology revisions.
Activation requires current sample validation and a ready private subtitle worker.
The requested Chinese, Japanese and Korean paths are configured and validated
with the saved key as part of production setup. The administrator does not need
to add or enable them manually. Battle-command quality remains a separate check.
Isolated real DAVE receipt and rejoin passed with one member;
see the test report for the separate application and browser evidence.
Isolated [media compatibility checks](docs/media-compatibility.md) record native
cleanup, actual synthetic audio reception and the self-hosted LiveKit token-reuse
failure. Werift 0.25.1 is now used by the worker after these checks and actual
application admission tests. Other candidate SDKs remain isolated from the app.

## Multi-room entry and tactical map

The current source adds a public room directory at `/`, room entry at
`/rooms/:roomNumber`, and Discord installation at `/rooms/create`. These changes need
all database migrations and server-side Discord application configuration.
Migration `0017` assigns existing community rooms their public numbers; old UUID
room links are not supported.
The existing production acceptance evidence above predates this feature.

Creators must select an Asia server and may restrict entry to up to 200 character
IDs. The server checks AION2 Index's API for an exact character/server match;
that game ID becomes the room display name. An empty allowlist admits all indexed
characters on that server. Community rooms have independent sessions and duplicate
ID replacement within each room.

Members draw on the original Lower Reshanta tile layer with pan, wheel/pinch,
keyboard zoom and reset. Lines stay in map coordinates, display their author's ID,
and persist in PostgreSQL. An eraser removes the author's entire stroke by click
or drag; undo and individual deletion are also available. Other members' lines
remain protected. See [multi-room setup and limits](docs/multi-room-and-map.md).
The public navigation no longer displays administration; `/admin` keeps Access
protection and adds a room selector. Publish the original configured room by
setting its server under “加入规则”; it reuses the existing Discord source and
requires existing members to enter again through character validation.

## Start locally

Use Node 24.18.0 and Docker Compose.

```sh
nvm use
npm ci
cp .env.example .env
npm run db:up
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`. The page starts with no enabled subtitle languages.
With a migrated database and configured Discord installation, a player can create
a room and enter as `JOINING`
(HTTP 202), view the current list and keep the session connected. With the optional
private media worker configured, the current session can become ACTIVE after all
older transports confirm closure. This authorizes a receive-only connection;
Discord audio stays stopped until an administrator starts a configured source.
Without database configuration entry is disabled and the API
returns 503. The player page does not require an account or Access login.

To exercise local media admission, generate a separate random secret of at least
32 characters and set both `MEDIA_CONTROL_SECRET` and `NUXT_MEDIA_CONTROL_SECRET`
to that value in ignored `.env`. Set `NUXT_MEDIA_CONTROL_URL=http://127.0.0.1:3100`,
then run `npm run build` and, in a separate terminal,
`node --env-file=.env apps/voice-worker/dist/index.mjs`. Restart the web app after
configuration changes. No capture permission is requested. See
[media admission](docs/media-admission.md) for recovery limits and
[media networking](docs/media-network.md) for STUN/TURN, TLS and UDP port settings.
Both services supervise a child runtime and reconcile its confirmed exit before
restarting it. The web production entry is `apps/web/.output/server/supervisor.mjs`
(`npm run start` and the Docker image use it). Apply all migrations first; see
[process recovery](docs/worker-recovery.md) for storage fencing and host-crash limits.
The private [Kubernetes recovery controller](docs/kubernetes-recovery.md) handles
whole-container loss using Pod admission barriers and verified termination
evidence. Its deployment, credentials and API permissions belong in infra.

The `/admin` page fails closed until Access is configured. Set
`NUXT_ACCESS_TEAM_DOMAIN`, `NUXT_ACCESS_AUDIENCE`, and a random
`NUXT_BETTER_AUTH_SECRET` of at least 32 characters in `.env`. Use the real Access
proxy to test administrator sign-in. There is no development authentication
bypass. `NUXT_SITE_URL` must match the browser origin.
To save a bot credential, set `NUXT_PROVIDER_ENCRYPTION_KEY` to a protected,
base64-encoded 32-byte random key, and set the worker's `PROVIDER_ENCRYPTION_KEY`
to that same protected value. Configure the guild, ordinary voice channel and
capture scope through `/admin`, then select **启动房间**. Only View Channel and
Connect permissions are required; private channel overrides must also allow the
bot. See [original audio](docs/original-audio.md) and [room configuration](docs/room-configuration.md)
for field limits, version conflicts, and credential recovery requirements. The same
protected key encrypts provider credentials and their history; see
[provider configuration](docs/providers-and-languages.md) for test scope and limits.

`DATABASE_URL` is used by database tools. `NUXT_DATABASE_URL` is the private Nuxt
runtime setting. Point both at the same database. The example database credentials
are for the local Compose service only.
Set `NUXT_DATABASE_POOL_MAX` and `DATABASE_POOL_MAX` to fit the database connection
budget, including supervisors and rolling updates. See
[connection budgeting](docs/operations.md#database-connection-budget).

## Workspace

| Path                              | Responsibility                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `apps/web`                        | Nuxt player/administrator pages, Nitro HTTP APIs and player WebSockets                         |
| `apps/voice-worker`               | Exclusive Discord reception, per-member decoding, bounded playback mixing and revocable WebRTC |
| `packages/auth`                   | Cloudflare JWT verification and administrator Better Auth sessions                             |
| `packages/database`               | Drizzle schema, migrations, listener transactions and revocation coordinator                   |
| `packages/contracts`              | Browser-safe nickname, language, room, and subtitle contracts                                  |
| `packages/providers`              | Server-only OpenAI streaming recognition/translation, probes and samples                       |
| `packages/processes`              | Shared child-process supervision, private bootstrap and confirmed exit reconciliation          |
| `packages/telemetry`              | Server-only OpenTelemetry setup and speech-to-subtitle latency traces and metrics              |
| `.agents/skills/better-interface` | The requested interface review skill                                                           |
| `scripts`                         | Source size checks, worktree inventory, built HTTP smoke checks                                |

The structure follows the related `perohub-monorepo` repository. Shared domain
code lives in packages. Production resources belong in the existing `infra`
repository. The application runs as a Node server; continuous Discord audio
runs in a separate worker.

## Commands

| Command                        | Purpose                                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                  | Start the local Nuxt app                                                                                                                                                              |
| `npm run build`                | Build the web app, standalone migrations, and supervised web/worker entry points                                                                                                      |
| `npm start`                    | Run the supervised built Nuxt server                                                                                                                                                  |
| `npm run ci:local`             | Source limits, formatting, types, unit tests, build, HTTP smoke                                                                                                                       |
| `npm run test:db`              | Real PostgreSQL administrator sessions, listener lifecycle, source start/stop and exclusive ownership tests                                                                           |
| `npm run test:http:db`         | Built server + local PostgreSQL: entry, replacement, isolation and restart; run after build/migrations                                                                                |
| `npm run test:ws:db`           | Two built servers + local PostgreSQL: real player WebSockets, replacement, shutdown and recovery                                                                                      |
| `npm run test:media:db`        | Real Opus publication and source fencing; two built servers + worker/PostgreSQL admission, revocation and recovery                                                                    |
| `npm run test:network:db`      | Real Coturn UDP/TCP/TLS, UDP fallback, credential expiry and bounded ICE ports; requires Docker and OpenSSL, creates its own disposable database                                      |
| `npm run test:recovery:db`     | Isolated PostgreSQL and built web/voice processes: SIGKILL, real socket release, blocked receipts, scoped recovery, old credentials and normal shutdown                               |
| `npm run test:pools:db`        | Actual PostgreSQL connection budgets under concurrent web/worker requests, queue recovery and invalid startup settings                                                                |
| `npm run test:restore:db`      | Real PostgreSQL custom-format backup/restore, configuration and credential recovery, and preserved uncertain transport receipts                                                       |
| `npm run test:rollback:images` | Previously published web images against disposable PostgreSQL: upgrade, rollback, forward recovery, retained settings and administrator access                                        |
| `npm run test:subtitles:db`    | Built web + real private worker HTTP/player WebSockets, isolated PostgreSQL and loopback provider protocols: shared PCM, language changes, source/provider replacement and revocation |
| `npm run test:management:db`   | Built servers + local PostgreSQL: signed admin login, encrypted room settings, conflicts, stop and removal                                                                            |
| `npm run test:providers:db`    | Built servers + local PostgreSQL: provider history, encrypted credentials, replacement and test leases; local provider fixtures                                                       |
| `npm run test:samples:db`      | Built servers + local PostgreSQL: authorized WAV sample processing, transcript revisions, upload limits and stale-result rejection; local provider fixtures                           |
| `npm run test:terms:db`        | Built servers + local PostgreSQL: terminology CRUD, aliases, concurrent edits, restart, pagination and redacted audit                                                                 |
| `npm run test:languages:db`    | Built servers + local PostgreSQL: language paths, persisted validation, ordering/default, conflicts and fail-closed activation                                                        |
| `npm run db:generate`          | Generate a migration after schema changes                                                                                                                                             |
| `npm run db:migrate`           | Apply committed migrations using `.env`                                                                                                                                               |
| `npm run db:studio`            | Open the local schema browser using `.env`                                                                                                                                            |
| `npm run db:down`              | Stop the local database without deleting its volume                                                                                                                                   |
| `npm run worktree:audit`       | Show worktrees and remote availability without deleting anything                                                                                                                      |

Source files should remain below 600 lines; 800 is the enforced maximum.
Configuration, generated migrations, lockfiles, and vendored skills are exempt.
See [AGENTS.md](AGENTS.md) for worktree, cleanup, security, and interface rules.

## Documentation

- [Architecture and next implementation gates](docs/architecture.md)
- [Administrator access](docs/access-control.md)
- [Room settings and protected Discord credentials](docs/room-configuration.md)
- [Listener lifecycle and API](docs/listener-sessions.md)
- [Providers and output languages](docs/providers-and-languages.md)
- [Output-language configuration and validation](docs/output-languages.md)
- [Game terms and sample terminology context](docs/game-terms.md)
- [Shared streaming subtitle processing](docs/streaming-subtitles.md)
- [Speech-to-subtitle latency tracing](docs/latency-tracing.md)
- [Player subtitle window and browser limits](docs/picture-in-picture.md)
- [Media admission, configuration and recovery limits](docs/media-admission.md)
- [STUN/TURN configuration, temporary credentials and network verification](docs/media-network.md)
- [Discord original audio and source lifecycle](docs/original-audio.md)
- [Media dependency compatibility evidence](docs/media-compatibility.md)
- [Production deployment](docs/deployment.md)
- [Operations, backup, and rollback](docs/operations.md)
- [Validation and unfinished live checks](docs/test-report.md)
- [Interface skill installation](docs/interface-skills.md)

The deployed web URLs are `https://babel.juryquinn.com` and
`https://babel.juryquinn.com/admin`. Pull requests run CI on ser7; every `main`
update automatically validates and publishes web/voice images to DigitalOcean,
then updates the existing infra ArgoCD image tags. Production configuration and
deployment-specific tooling live in the separate private infra repository.
See the [automatic release setup](docs/deployment.md#automatic-main-releases).
The current web and voice release passed
production migrations, replica readiness, private control authentication, public
TURN forwarding and actual browser media connection/exit checks. The production
Discord source now connects after authenticated administrator setup and has
decoded one real member's audio with human-confirmed browser playback.
The deployed recovery controller and Pod-bound owners have passed readiness and
permission checks; abrupt production failure remains untested.
Multiple-speaker behavior, subtitle quality and player-network acceptance remain unfinished;
see [deployment evidence](docs/deployment.md) and
[source and secret boundaries](docs/source-and-secrets.md).
