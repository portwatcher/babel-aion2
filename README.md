# Babel · AION2 深渊战

Live voice relay and subtitles for AION2 (Steam Global / Asia) battle groups.
A host's voice reaches players as original audio, with real-time captions and
Chinese, Japanese and Korean translation.

Built with Nuxt 4, Better Auth and PostgreSQL. Deployed at
[babel.juryquinn.com](https://babel.juryquinn.com/). The product specification
is in [design.md](design.md), mirrored in [GOAL.md](GOAL.md).

## Features

- **Rooms.** Public directory at `/`, numbered rooms at `/rooms/:roomNumber`.
  Players enter with a character ID verified against AION2 Index; no account
  needed. Creators pick an Asia server and may restrict entry to up to 200
  character IDs.
- **Audio sources.** Either _host capture_ (the host broadcasts computer audio
  or any input from the browser) or a _Discord_ voice channel via the bot.
  See [player audio source](docs/player-audio-source.md) and
  [original audio](docs/original-audio.md).
- **Room lifecycle.** Empty rooms disband after five minutes. The host can close
  a room at any time. See [community rooms](docs/multi-room-and-map.md).
- **Subtitles.** OpenAI realtime transcription and translation, pushed to the
  page and a Picture-in-Picture window. Translation runs only for languages with
  subscribers. See [streaming subtitles](docs/streaming-subtitles.md).
- **Tactical map.** Shared drawing on the Lower Reshanta map, persisted per room.
- **Interface languages.** English, Simplified Chinese, Japanese and Korean.
  See [interface localization](docs/interface-localization.md).
- **Administration.** `/admin` is protected by Cloudflare Access and holds only
  the OpenAI API key and game terms. See [access control](docs/access-control.md).

Current live acceptance status is tracked in the
[test report](docs/test-report.md).

## Start locally

Requires Node 24.18.0 and Docker Compose.

```sh
nvm use
npm ci
cp .env.example .env
npm run db:up
npm run db:migrate
npm run dev
```

Open `http://localhost:3000`. Without a database, entry is disabled and the API
returns 503.

Optional configuration in `.env`:

- **Voice worker.** Set `MEDIA_CONTROL_SECRET` and `NUXT_MEDIA_CONTROL_SECRET` to
  the same random value (32+ characters) and
  `NUXT_MEDIA_CONTROL_URL=http://127.0.0.1:3100`. Run `npm run build`, then
  `node --env-file=.env apps/voice-worker/dist/index.mjs`. See
  [media admission](docs/media-admission.md) and
  [media networking](docs/media-network.md).
- **Administration.** Set `NUXT_ACCESS_TEAM_DOMAIN`, `NUXT_ACCESS_AUDIENCE` and
  `NUXT_BETTER_AUTH_SECRET`. `/admin` fails closed without them; there is no
  development bypass.
- **Secrets.** Set `NUXT_PROVIDER_ENCRYPTION_KEY` and `PROVIDER_ENCRYPTION_KEY` to
  the same base64-encoded 32-byte key.
- **Discord.** Set `NUXT_DISCORD_CLIENT_ID`, `NUXT_DISCORD_CLIENT_SECRET` and
  `NUXT_DISCORD_BOT_TOKEN`.

`DATABASE_URL` (tools) and `NUXT_DATABASE_URL` (runtime) must point at the same
database. Size the pools with `DATABASE_POOL_MAX` and `NUXT_DATABASE_POOL_MAX`;
see [connection budgeting](docs/operations.md#database-connection-budget).

## Workspace

| Path                 | Responsibility                                                |
| -------------------- | ------------------------------------------------------------- |
| `apps/web`           | Nuxt pages, HTTP APIs and player WebSockets                   |
| `apps/voice-worker`  | Discord reception, audio mixing and WebRTC delivery           |
| `packages/auth`      | Cloudflare Access JWT verification and administrator sessions |
| `packages/database`  | Drizzle schema, migrations and listener transactions          |
| `packages/contracts` | Browser-safe shared contracts                                 |
| `packages/providers` | Server-only OpenAI recognition and translation                |
| `packages/processes` | Child-process supervision                                     |
| `packages/telemetry` | OpenTelemetry tracing and metrics                             |
| `scripts`            | Source checks, smoke tests and worktree inventory             |

## Commands

| Command                  | Purpose                                                     |
| ------------------------ | ----------------------------------------------------------- |
| `npm run dev`            | Start the local Nuxt app                                    |
| `npm run build`          | Build web, migrations and worker                            |
| `npm start`              | Run the built, supervised server                            |
| `npm run ci:local`       | Line limits, formatting, types, unit tests, build and smoke |
| `npm run test:db`        | Database integration tests against local PostgreSQL         |
| `npm run test:*:db`      | Built-server integration suites; see `package.json`         |
| `npm run db:generate`    | Generate a migration after schema changes                   |
| `npm run db:migrate`     | Apply migrations                                            |
| `npm run db:studio`      | Open the schema browser                                     |
| `npm run db:down`        | Stop the local database, keeping its volume                 |
| `npm run worktree:audit` | List worktrees and remote status                            |

Contributor rules (file size limits, security boundaries, worktrees) are in
[AGENTS.md](AGENTS.md).

## Deployment

Every push to `main` runs CI, publishes web and voice images, and updates the
image tags in the private infra repository. See
[deployment](docs/deployment.md), [operations](docs/operations.md) and
[source and secret boundaries](docs/source-and-secrets.md).

## Documentation

- [Architecture](docs/architecture.md)
- [Access control](docs/access-control.md)
- [Room configuration](docs/room-configuration.md)
- [Listener sessions](docs/listener-sessions.md)
- [Providers and languages](docs/providers-and-languages.md)
- [Output languages](docs/output-languages.md)
- [Game terms](docs/game-terms.md)
- [Streaming subtitles](docs/streaming-subtitles.md)
- [Latency tracing](docs/latency-tracing.md)
- [Picture-in-Picture](docs/picture-in-picture.md)
- [Media admission](docs/media-admission.md)
- [Media networking](docs/media-network.md)
- [Original audio](docs/original-audio.md)
- [Media compatibility](docs/media-compatibility.md)
- [Process recovery](docs/worker-recovery.md)
- [Kubernetes recovery](docs/kubernetes-recovery.md)
- [Deployment](docs/deployment.md)
- [Operations](docs/operations.md)
- [Test report](docs/test-report.md)
- [Interface skills](docs/interface-skills.md)
