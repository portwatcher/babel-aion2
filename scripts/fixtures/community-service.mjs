import { createServer } from 'node:http'
import { once } from 'node:events'

export async function communityService() {
  const guilds = {
    alpha: '100000000000000001',
    beta: '100000000000000002',
    gamma: '100000000000000003',
  }
  const creator = '100000000000000010'
  const bot = '100000000000000020'
  const channel = '100000000000000030'
  const alternateChannel = '100000000000000032'
  const forbiddenChannel = '100000000000000031'
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    let status = 200
    let body
    if (url.pathname === '/index') {
      const name = url.searchParams.get('q')
      if (name === 'Unavailable') {
        status = 503
        body = {}
      } else {
        const names = ['Pilot', 'Scout', 'Solo', '<Pilot>']
        body = {
          suggestions: names.includes(name)
            ? [
                {
                  name,
                  href: `/c/eu/siel/${encodeURIComponent(name)}`,
                  region: 'eu',
                  server: 'Siel',
                  className: 'Ranger',
                  level: 45,
                },
                {
                  name: name.toLowerCase(),
                  href: `/c/as/siel/${encodeURIComponent(name.toLowerCase())}`,
                  region: 'as',
                  server: 'Siel',
                  className: 'Ranger',
                  level: 45,
                },
                ...['siel', 'nezekan'].map((realm) => ({
                  name,
                  href: `/c/as/${realm}/${encodeURIComponent(name)}`,
                  region: 'as',
                  server: realm,
                  className: 'Ranger',
                  level: 45,
                })),
              ]
            : [],
        }
      }
      if (url.searchParams.get('q') === 'OtherRealm') {
        body = {
          suggestions: [
            {
              name: 'OtherRealm',
              href: '/c/as/nezekan/OtherRealm',
              region: 'as',
              server: 'Nezekan',
              className: 'Ranger',
              level: 45,
            },
          ],
        }
      }
      if (url.searchParams.get('q') === 'OtherRegion') {
        body = {
          suggestions: [
            {
              name: 'OtherRegion',
              href: '/c/eu/siel/OtherRegion',
              region: 'eu',
              server: 'Siel',
              className: 'Ranger',
              level: 45,
            },
          ],
        }
      }
      if (url.searchParams.get('q') === 'CaseOnly') {
        body = {
          suggestions: [
            {
              name: 'caseonly',
              href: '/c/as/siel/caseonly',
              region: 'as',
              server: 'Siel',
              className: 'Ranger',
              level: 45,
            },
          ],
        }
      }
      if (url.searchParams.get('q') === 'SchemaFailure') {
        body = { suggestions: [{ name: 'SchemaFailure' }] }
      }
    } else if (url.pathname === '/discord/oauth2/token') {
      let text = ''
      for await (const chunk of request) {
        text += chunk
      }
      const code = new URLSearchParams(text).get('code')
      const id = guilds[code]
      if (!id) {
        status = 400
        body = {}
      } else {
        body = { access_token: `fixture-${code}`, guild: { id } }
      }
    } else if (url.pathname === '/discord/oauth2/applications/@me') {
      body = { id: bot }
    } else if (url.pathname === '/discord/users/@me') {
      body = request.headers.authorization?.startsWith('Bot ')
        ? { id: bot, bot: true }
        : { id: creator }
    } else if (url.pathname === '/discord/users/@me/guilds') {
      body = Object.values(guilds).map((id) => ({
        id,
        permissions: '32',
        owner: false,
      }))
    } else {
      const id = url.pathname.split('/')[3]
      if (url.pathname.endsWith(`/members/${bot}`)) {
        body = { roles: [bot] }
      } else if (url.pathname.endsWith('/roles')) {
        body = [
          { id, permissions: '0' },
          { id: bot, permissions: '3146752' },
        ]
      } else if (url.pathname.endsWith('/channels')) {
        body = [
          {
            id: channel,
            guild_id: id,
            name: '指挥频道',
            type: 2,
            permission_overwrites: [],
          },
          {
            id: alternateChannel,
            guild_id: id,
            name: '备用频道',
            type: 2,
            permission_overwrites: [],
          },
          {
            id: forbiddenChannel,
            guild_id: id,
            name: '受限频道',
            type: 2,
            permission_overwrites: [{ id: bot, type: 1, deny: '1048576', allow: '0' }],
          },
        ]
      } else {
        status = 404
        body = {}
      }
    }
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    channel,
    forbiddenChannel,
    alternateChannel,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  }
}
