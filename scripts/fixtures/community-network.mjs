// Only imported by the integration test process. Production destinations remain
// fixed and have no endpoint overrides or admission bypasses.
if (process.env.BABEL_TEST_COMMUNITY_ORIGIN) {
  const local = new URL(process.env.BABEL_TEST_COMMUNITY_ORIGIN)
  if (local.protocol !== 'http:' || local.hostname !== '127.0.0.1') {
    throw new Error('Community fixture must listen on loopback')
  }
  const networkFetch = globalThis.fetch
  globalThis.fetch = (input, options) => {
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (
      url.origin === 'https://aion2index.com' &&
      url.pathname === '/api/search/suggest'
    ) {
      return networkFetch(`${local.origin}/index${url.search}`, options)
    }
    if (url.origin === 'https://discord.com' && url.pathname.startsWith('/api/v10/')) {
      return networkFetch(
        `${local.origin}/discord${url.pathname.slice('/api/v10'.length)}${url.search}`,
        options,
      )
    }
    return networkFetch(input, options)
  }
}
