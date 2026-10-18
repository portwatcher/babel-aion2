# Administrator access

The reference is the existing NPCify administrator app and its Access setup in
the related `infra` repository. Babel uses the same JOSE verification approach,
with its own Access application audience. Do not reuse another application's
audience or trust its email header.

## Boundaries

| Route                                                                              | Required checks                                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `/`, `/api/player/*`                                                               | Public configuration/list or listener-session authorization                                |
| `/admin`, `/admin/*`                                                               | Verified Cloudflare Access assertion                                                       |
| `/api/management/identity`                                                         | Verified Access assertion, for administrator page bootstrap                                |
| `/api/management/status`                                                           | Verified Access assertion plus matching Better Auth session                                |
| `/api/management/room`, `/api/management/room/stop`, `/api/management/listeners/*` | Verified Access assertion plus matching Better Auth session; mutations require same origin |
| `/api/auth/*`                                                                      | Verified Access assertion; only the three mounted auth operations exist                    |

The server fetches keys from the configured team's fixed
`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` endpoint. It requires
RS256 and checks issuer, audience, expiration, issued-at, optional not-before,
subject, and email. Arbitrary key URLs are rejected. Cached remote JWKS keys
support rotation. Neither an email header nor a session cookie grants Access.

Every management mutation must use `requireAdministratorSession`, with the
explicit browser Origin matching `NUXT_SITE_URL`. The helper rejects an absent
Origin as well as a foreign one. No origin is inferred from forwarded headers.
Management responses use `private, no-store`.

## Better Auth bridge

After Access authorizes the page, it makes a same-origin
`POST /api/auth/sign-in/cloudflare`. The plugin verifies Access again, upserts
the issuer/subject identity, and creates a one-hour session. Cookies are HTTP-only,
SameSite=Lax, and Secure when the configured site URL uses HTTPS. The sign-in
response does not expose a session token.
The Nitro bridge preserves an absent POST body. H3 otherwise presents an empty
stream to Better Auth, causing a bodyless browser sign-in to fail with 415.

Subsequent status requests need both the current Access assertion and a session
whose user ID matches that signed identity. Restarting the application preserves
database-backed sessions. Email/password and social sign-up are disabled.

## Production setup still required

Configure Access applications for both `/admin` page paths and the actual
`/api/management/*` and `/api/auth/*` paths. Apply the existing operator policy.
Protect origin reachability using the established infra network arrangement;
keep server JWT checks even behind a tunnel or proxy.

Set `NUXT_ACCESS_TEAM_DOMAIN`, `NUXT_ACCESS_AUDIENCE`, `NUXT_SITE_URL`,
`NUXT_BETTER_AUTH_SECRET`, and `NUXT_DATABASE_URL` from approved configuration.
Never add a default token, local administrator password, or development bypass.

`npm run test:management:db` runs the built Nitro server with generated RS256 keys
and a test-process-only JWKS transport. It signs in through the real bodyless POST,
persists the Better Auth cookie, and uses both proofs for management operations.
Cookie-only, JWT-only, forged JWT and foreign-origin requests are rejected.
The preload is outside the production app; there is no alternate production JWKS
URL or authentication bypass. Real Cloudflare policy, token issuance, routing,
and operator sign-in still require live checks.
