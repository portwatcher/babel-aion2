# Babel · AION2 深渊站

Nuxt 4 + Better Auth + PostgreSQL project scaffold for AION2 Steam Global / Asia.
Repository: [portwatcher/babel-aion2](https://github.com/portwatcher/babel-aion2),
private today and prepared for eventual open source.
The player interface is a dark, low-distraction battle panel. The original
requirements are kept in sync in [design.md](design.md) and [GOAL.md](GOAL.md).

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
within the same listener. Local relay proof does not establish public reachability.
Administrators can save versioned room/Discord settings, protect the bot credential
with server-side encryption, persist a stopped room, and remove a specific listener
generation. Saving a changed source stops it; the separate start action requests
connection and the page polls actual worker status.
Discord scope can be either selected member IDs or all speaking members of the
configured channel. All-channel mode requires no prefilled commander IDs;
the worker discovers speakers by Discord user ID and shows received frame counts.
The administrator can also save encrypted Soniox/DeepL candidate configurations,
run connection probes, replace credentials, and test/restore historical versions.
An authorized PCM WAV sample can be recognized through Soniox and translated
through DeepL for an administrator-only comparison of source and translated text.
Administrators can edit versioned game terms and compare samples with or without
their source and output-language terminology context.
Samples use the shared streaming processor: recognition and translation overlap,
and obsolete revisions are cancelled before they can replace current text.
Administrators can prepare output-language paths, order them, choose a default,
and save sample validation tied to the exact provider and terminology revisions.
Activation requires current sample validation and a ready private subtitle worker.
New installations still have no languages or credentials; the administrator chooses
which validated paths to enable. Live provider quality is unvalidated.
Isolated real DAVE receipt and rejoin passed with one member;
see the test report for the separate application and browser evidence.
Isolated [media compatibility checks](docs/media-compatibility.md) record native
cleanup, actual synthetic audio reception and the self-hosted LiveKit token-reuse
failure. Werift 0.25.1 is now used by the worker after these checks and actual
application admission tests. Other candidate SDKs remain isolated from the app.

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
With a migrated database, a player can enter the waiting room as `JOINING`
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
| `packages/providers`              | Server-only Soniox recognition, DeepL translation, probes and sample comparison                |
| `packages/processes`              | Shared child-process supervision, private bootstrap and confirmed exit reconciliation          |
| `.agents/skills/better-interface` | The requested interface review skill                                                           |
| `scripts`                         | Source size checks, worktree inventory, built HTTP smoke checks                                |

The structure follows the related `perohub-monorepo` repository. Shared domain
code lives in packages. Production resources belong in the existing `infra`
repository. The application runs as a Node server; continuous Discord audio
runs in a separate worker.

## Commands

| Command                      | Purpose                                                                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                | Start the local Nuxt app                                                                                                                                                              |
| `npm run build`              | Build the web app, standalone migrations, and supervised web/worker entry points                                                                                                      |
| `npm start`                  | Run the supervised built Nuxt server                                                                                                                                                  |
| `npm run ci:local`           | Source limits, formatting, types, unit tests, build, HTTP smoke                                                                                                                       |
| `npm run test:db`            | Real PostgreSQL administrator sessions, listener lifecycle, source start/stop and exclusive ownership tests                                                                           |
| `npm run test:http:db`       | Built server + local PostgreSQL: entry, replacement, isolation and restart; run after build/migrations                                                                                |
| `npm run test:ws:db`         | Two built servers + local PostgreSQL: real player WebSockets, replacement, shutdown and recovery                                                                                      |
| `npm run test:media:db`      | Real Opus publication and source fencing; two built servers + worker/PostgreSQL admission, revocation and recovery                                                                    |
| `npm run test:network:db`    | Real Coturn UDP/TCP/TLS, UDP fallback, credential expiry and bounded ICE ports; requires Docker and OpenSSL, creates its own disposable database                                      |
| `npm run test:recovery:db`   | Isolated PostgreSQL and built web/voice processes: SIGKILL, real socket release, blocked receipts, scoped recovery, old credentials and normal shutdown                               |
| `npm run test:pools:db`      | Actual PostgreSQL connection budgets under concurrent web/worker requests, queue recovery and invalid startup settings                                                                |
| `npm run test:restore:db`    | Real PostgreSQL custom-format backup/restore, configuration and credential recovery, and preserved uncertain transport receipts                                                       |
| `npm run test:subtitles:db`  | Built web + real private worker HTTP/player WebSockets, isolated PostgreSQL and loopback provider protocols: shared PCM, language changes, source/provider replacement and revocation |
| `npm run test:management:db` | Built servers + local PostgreSQL: signed admin login, encrypted room settings, conflicts, stop and removal                                                                            |
| `npm run test:providers:db`  | Built servers + local PostgreSQL: provider history, encrypted credentials, replacement and test leases; local provider fixtures                                                       |
| `npm run test:samples:db`    | Built servers + local PostgreSQL: authorized WAV sample processing, transcript revisions, upload limits and stale-result rejection; local provider fixtures                           |
| `npm run test:terms:db`      | Built servers + local PostgreSQL: terminology CRUD, aliases, concurrent edits, restart, pagination and redacted audit                                                                 |
| `npm run test:languages:db`  | Built servers + local PostgreSQL: language paths, persisted validation, ordering/default, conflicts and fail-closed activation                                                        |
| `npm run db:generate`        | Generate a migration after schema changes                                                                                                                                             |
| `npm run db:migrate`         | Apply committed migrations using `.env`                                                                                                                                               |
| `npm run db:studio`          | Open the local schema browser using `.env`                                                                                                                                            |
| `npm run db:down`            | Stop the local database without deleting its volume                                                                                                                                   |
| `npm run worktree:audit`     | Show worktrees and remote availability without deleting anything                                                                                                                      |

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
`https://babel.juryquinn.com/admin`. Releases and production configuration live in
the separate private infra repository. The current web release passed production
migrations, replica readiness, public HTTP and Access-boundary checks. Production
voice-worker networking and live audio/subtitle acceptance remain unfinished;
see [deployment evidence](docs/deployment.md) and
[source and secret boundaries](docs/source-and-secrets.md).
