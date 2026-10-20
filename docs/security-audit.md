# Security audit

Installed on 2026-10-20 from
[cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill)
at commit `c1c8a8c`. The project copy is `.agents/skills/security-audit`,
including its validators and license. `npm run check:lines` skips vendored
skills.

## 2026-10-20 run

Quick profile, source review of `0193cce`. Five hunters covered player
sessions and rooms, administrator authentication, WebSocket/media/worker
control, resource limits and outbound fetches, and CI/containers. Target code
was not executed during hunting. The coverage critic and independent
verifiers did not run, so this is a partial pass. Fixes were checked with the
repository's own tests.

| Result                                                                           | Status                                                                                                                                                                     |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Map stroke quota/eraser reset on character re-entry (low)                        | Fixed, regression test                                                                                                                                                     |
| Pre-auth WebSocket frames buffered up to 100 MiB                                 | Fixed: transport `maxPayload` 2 KiB                                                                                                                                        |
| Unbounded `readBody` on player and admin routes                                  | Fixed: 64 KiB bounded reader                                                                                                                                               |
| Admin path guard was case-sensitive                                              | Fixed (hardening)                                                                                                                                                          |
| `.claude` not in `.dockerignore`                                                 | Fixed (hardening)                                                                                                                                                          |
| Anonymous room creation has no quota; rows never purged                          | Open: needs a product limit                                                                                                                                                |
| Release secrets are repository-scoped, PR and release share a self-hosted runner | Fixed: PRs run GitHub-hosted; release uses the `main`-only `production` environment; fork runs need approval. Secret values must be moved to that environment by the owner |

Rejected: host impersonation through an unproven character ID is the accepted
design (no ownership checks), and entry validation details exposed no secrets.

Hardening not yet applied: TURN credentials stay valid until expiry after a
session is revoked; remote ICE candidates are not filtered when
`MEDIA_ICE_POLICY=all`; `actions/checkout` persists the read-only token; base
images are pinned by tag rather than digest.
