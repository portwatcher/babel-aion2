// Test process preload only. The production app has no alternate JWKS URL,
// identity injection flag or authentication bypass. It still verifies the
// signed assertion and matches the persisted Better Auth session.
const keys = JSON.parse(process.env.BABEL_TEST_JWKS ?? 'null')
if (
  !keys ||
  !['127.0.0.1', 'localhost'].includes(new URL(process.env.NUXT_SITE_URL).hostname)
) {
  throw new Error('Local Access fixture is not configured')
}
const networkFetch = globalThis.fetch
globalThis.fetch = async (input, options) => {
  const url = input instanceof Request ? input.url : String(input)
  if (url === 'https://babel-smoke.cloudflareaccess.com/cdn-cgi/access/certs') {
    return Response.json(keys)
  }
  return networkFetch(input, options)
}
