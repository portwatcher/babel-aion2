# Babel project guidance

## Scope and references

- Read `design.md` before changing behavior. It contains the original product
  specification. `GOAL.md` is the identical delivery reference. Keep both in sync.
- This repository is an application scaffold. See `docs/architecture.md` and
  `docs/test-report.md` for implemented behavior and unfinished integration gates.
- Follow the workspace patterns in the related repository
  `../perohub-monorepo`: npm workspaces, `apps/*`, `packages/*`, shared contracts,
  domain modules, conventional commits, and deterministic local checks.
- Use the related `../infra` repository for production resources and established
  deployment methods. Never copy credentials or private runtime configuration.
- `portwatcher/babel-aion2` is private today but intended for future open source.
  Keep source and Git history free of real credentials, private network addresses,
  production database names, Access application identities, and deployment keys.
  Development-only `.env.example` files are allowed. Production configuration and
  deployment-specific release tooling belong in the separate private infra
  repository. The generic source CI/release workflow may use repository secrets
  and variables to call that tooling; never inline production values.
- Respond in clear, direct language. State actual test results and limitations.

## Worktree management

- For code-changing tasks, use a dedicated Codex-managed worktree unless the user
  explicitly requests the local checkout. Inspect attached worktrees first and
  reuse a suitable active one. Create worktrees through the Codex app tools.
- Keep new managed worktrees on detached HEAD until intentionally creating a
  task branch. Never check out `main`, `master`, or `develop` in a task worktree.
- Never create a task worktree in an operating-system temporary directory.
- Before integration, fetch the remote and incorporate the latest integration
  branch. Run `npm run ci:local`. Never force-push an integration branch.
- When the requested work is complete, automatically commit, push the task
  branch, open a pull request, wait for required checks, and merge into `main`.
  Do not stop at a local commit or ask for another push/merge confirmation.
  Respect an explicit user instruction to keep work unmerged. Resolve failures
  before merging and never bypass a required check or force-push `main`.
- Automatically clean up local and remote task branches already merged into the
  latest remote `main` and their completed worktrees at session start, after
  merging a task, and before session completion. Do not wait for another cleanup
  request or confirmation. Apply the removal checks below; preserve `main`, the
  primary checkout, and unfinished work.
- Before removal, verify task commits are contained in the latest remote
  integration branch, the worktree has no uncommitted or valuable untracked
  files, and no unfinished task is using it. If no remote exists, preserve the
  worktree and report that integration cannot be verified remotely.
- Prefer Codex-managed archival or cleanup. Run cleanup outside the target
  worktree. Identify exact PIDs, commands, and ownership. Move idle sessions to
  a stable directory or gracefully stop helpers owned only by the finished task.
  A cwd reference alone does not make a task active. Never kill another task's
  processes or the shared Codex host. Force-stop only confirmed leftover helpers.
- After these checks, forced removal is allowed when disposable generated files
  or stale references are the only blocker. Delete only merged task branches,
  prune metadata, and verify directories, registrations, and task branches are gone.
- Do not create another task or worktree just for cleanup. Preserve and report
  actual unmerged work, unknown valuable files, and another active task.
- At session start, completion, and after removal, check all accessible Codex
  tasks across projects for `Current working directory missing` or a confirmed
  nonexistent cwd on the owning host. Archive every match with
  `set_thread_archived`, `archived: true`, exact task ID, and owning host.
  The user authorizes this without completion checks, recovery, or confirmation.
  Verify success. Preserve chat history, surviving files, and branches. Do not
  recreate directories or replacement tasks. Host/permission errors are lookup
  failures, not proof of a missing directory; report them accurately.

## Source size and boundaries

- Prefer source files below 600 lines. **800 lines is the maximum.** Split by
  domain responsibility before exceeding the limit. Do not compress code to
  evade it. `npm run check:lines` warns at 600 and fails above 800.
- Configuration, generated migrations, lockfiles, and vendored skill resources
  are exempt. The line checker still examines all first-party application,
  shared-package, test, and script source, including untracked files.
- Use TypeScript strict mode. Avoid `as any`, double casts, and `@ts-ignore`.
  Use braces around conditionals. Prefer domain names to anonymous utility bags.
- Browser code may import `@babel/contracts`. Never import `@babel/database`,
  `@babel/auth`, provider clients, encryption keys, or credentials into the browser.
- Keep `packages/*` reusable and server dependencies explicit. Share contracts
  instead of re-declaring payloads in the web app and voice worker.

## Product and security boundaries

- Players use nickname listener sessions, without accounts or Cloudflare login.
  Better Auth is for administrators authenticated by Cloudflare Access.
- Protect `/admin`, nested admin pages, every `/api/management` operation, and
  administrator auth endpoints. Verify JWT signature, issuer, application
  audience, required identity claims, and time validity at the server boundary.
  Never authorize an email header or a Better Auth cookie by itself.
- Use HTTP polling for administration. Never add `/admin/ws` or an admin WebSocket.
- Use same-origin checks for management mutations. Do not add a development
  bypass or accept an arbitrary forwarded origin as a trusted configuration.
- Keep providers unavailable until implemented paths pass validation. Complete
  setup of the requested Simplified Chinese, Japanese and Korean output paths
  with the saved OpenAI key; do not require repeated language configuration.
  Never fabricate validation results, subtitles or players.
- `/admin` is website-wide and contains only the OpenAI API Key and game terms.
  Do not add room selection, Discord settings, listener management, language
  controls or room start/stop actions. Rooms bind Discord through creation.
- Authorize a new nickname generation only after confirming old subtitle and
  media delivery have stopped. Fail closed while transport revocation is absent.
- Keep original audio independent from transcription and translation. Select
  Discord/DAVE and media dependencies only after live compatibility checks.
- Encrypt dynamic provider secrets with a protected server key. Never return
  saved secrets, log them, commit them, or include them in exports.

## Interface and assets

- Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.
- Reuse established components and tokens. This scaffold follows Perohub's
  PrimeVue/Aura conventions. Extend or extract shared controls across Babel
  applications instead of making parallel button, input, select, or theme systems.
- Reuse official brand logos and icons. Never invent, redraw, or approximate a
  logo with text, CSS, custom artwork, or generated images. No official Babel
  logo has been supplied; the page title is ordinary text.
- The requested `better-interface` skill is installed at
  `.agents/skills/better-interface/SKILL.md`. Use it for combined interface
  reviews; use installed `better-*` domain skills for focused work.
- Cloudflare's `security-audit` skill is installed at
  `.agents/skills/security-audit/SKILL.md` for security reviews and audits.
  Keep audit run output outside the repository.
- Read `.impeccable.md` for the provisional design context. Keep player interface copy
  in the English, Simplified Chinese, Japanese and Korean catalogs, independent
  of selectable subtitle languages. Administration uses hard-coded English only.

## Validation and release

- Run `npm run ci:local` for source changes. Run `npm run test:db` when changing
  database behavior, using the disposable local PostgreSQL service.
- Use the installed `test-audit` authoring gate for tests. Test observable
  contracts and credible failure modes; do not mirror source or add test-only seams.
- Update the README and relevant docs when behavior, commands, or limits change.
  Record PASS, FAIL, NOT RUN, or WAITING FOR CONFIGURATION with evidence.
- Use conventional commits and a coding-agent coauthor trailer. Publish releases
  or deploy when ready. Every update to
  `main` automatically runs ser7 checks, builds and publishes immutable web and
  voice images to DigitalOcean, then updates the existing infra ArgoCD image
  tags. This continuous deployment is authorized; verify the workflow and rollout
  and report actual failures. Keep production manifests and deployment-specific
  tooling in private infra. Never publish production images from a local build.
- The repository is public. Pull-request jobs run on GitHub-hosted runners with
  no secrets. Only `main` releases use `[self-hosted, Linux, X64, ser7-homelab]`
  through the `production` environment, which holds release secrets and deploys
  from `main` alone. Never run pull-request code on the self-hosted runner.
  Keep local/CI checks equivalent.
- Production manifests belong in `../infra`; reuse public-edge, Access policy,
  secrets, databases, and GitOps conventions. No new LoadBalancer without cause.
