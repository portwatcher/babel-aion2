# Babel · AION2 深渊站

Nuxt 4 + Better Auth + PostgreSQL project scaffold for AION2 Steam Global / Asia.
The player interface is a dark, low-distraction battle panel. The original
requirements are preserved verbatim in [design.md](design.md) and [GOAL.md](GOAL.md).

Listener storage, HTTP operations and player WebSockets implement atomic global
nickname replacement, idempotent entry, browser restoration, language subscription
metadata, removal and reconciliation. The browser preserves its current session
across refresh/reconnection and stops after replacement. Live Discord audio, media
revocation, provider configuration, subtitle delivery and PiP remain unfinished.

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
(HTTP 202), view the current list and keep the session connected. This does not
grant command delivery: the media adapter remains unavailable, and no session
becomes ACTIVE. Without database configuration entry is disabled and the API
returns 503. The player page does not require an account or Access login.

The `/admin` page fails closed until Access is configured. Set
`NUXT_ACCESS_TEAM_DOMAIN`, `NUXT_ACCESS_AUDIENCE`, and a random
`NUXT_BETTER_AUTH_SECRET` of at least 32 characters in `.env`. Use the real Access
proxy to test administrator sign-in. There is no development authentication
bypass. `NUXT_SITE_URL` must match the browser origin.

`DATABASE_URL` is used by database tools. `NUXT_DATABASE_URL` is the private Nuxt
runtime setting. Point both at the same database. The example database credentials
are for the local Compose service only.

## Workspace

| Path                              | Responsibility                                                               |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `apps/web`                        | Nuxt player/administrator pages, Nitro HTTP APIs and player WebSockets       |
| `apps/voice-worker`               | Explicitly stopped entry point for the future audio worker                   |
| `packages/auth`                   | Cloudflare JWT verification and administrator Better Auth sessions           |
| `packages/database`               | Drizzle schema, migrations, listener transactions and revocation coordinator |
| `packages/contracts`              | Browser-safe nickname, language, room, and subtitle contracts                |
| `.agents/skills/better-interface` | The requested interface review skill                                         |
| `scripts`                         | Source size checks, worktree inventory, built HTTP smoke checks              |

The structure follows the related `perohub-monorepo` repository. Shared domain
code lives in packages. Production resources belong in the existing `infra`
repository. The application runs as a Node server; continuous Discord audio
will run in a separate worker.

## Commands

| Command                  | Purpose                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `npm run dev`            | Start the local Nuxt app                                                                               |
| `npm run build`          | Build the web app and worker entry point                                                               |
| `npm start`              | Run the built Nuxt server                                                                              |
| `npm run ci:local`       | Source limits, formatting, types, unit tests, build, HTTP smoke                                        |
| `npm run test:db`        | Real PostgreSQL administrator sessions and listener lifecycle tests                                    |
| `npm run test:http:db`   | Built server + local PostgreSQL: entry, replacement, isolation and restart; run after build/migrations |
| `npm run test:ws:db`     | Two built servers + local PostgreSQL: real player WebSockets, replacement, shutdown and recovery       |
| `npm run db:generate`    | Generate a migration after schema changes                                                              |
| `npm run db:migrate`     | Apply committed migrations using `.env`                                                                |
| `npm run db:studio`      | Open the local schema browser using `.env`                                                             |
| `npm run db:down`        | Stop the local database without deleting its volume                                                    |
| `npm run worktree:audit` | Show worktrees and remote availability without deleting anything                                       |

Source files should remain below 600 lines; 800 is the enforced maximum.
Configuration, generated migrations, lockfiles, and vendored skills are exempt.
See [AGENTS.md](AGENTS.md) for worktree, cleanup, security, and interface rules.

## Documentation

- [Architecture and next implementation gates](docs/architecture.md)
- [Administrator access](docs/access-control.md)
- [Listener lifecycle and API](docs/listener-sessions.md)
- [Providers and output languages](docs/providers-and-languages.md)
- [Deployment handoff](docs/deployment.md)
- [Operations, backup, and rollback](docs/operations.md)
- [Validation and unfinished live checks](docs/test-report.md)
- [Interface skill installation](docs/interface-skills.md)

The target production URLs are `https://babel.juryquinn.com` and
`https://babel.juryquinn.com/admin`. This scaffolding task does not deploy them.
