import { createRemoteJWKSet, jwtVerify } from 'jose'

export interface AccessConfiguration {
  teamDomain: string
  audience: string
}

export interface AdministratorIdentity {
  subject: string
  email: string
  issuer: string
}

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export async function verifyAccessAssertion(
  assertion: string,
  configuration: AccessConfiguration,
): Promise<AdministratorIdentity> {
  const domain = configuration.teamDomain.replace(/^https:\/\//, '').replace(/\/$/, '')
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(domain) || !configuration.audience) {
    throw new Error('Cloudflare Access is not configured')
  }
  const issuer = `https://${domain}`
  let keys = keySets.get(issuer)
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`))
    keySets.set(issuer, keys)
  }
  const { payload } = await jwtVerify(assertion, keys, {
    algorithms: ['RS256'],
    issuer,
    audience: configuration.audience,
    requiredClaims: ['exp', 'iat', 'sub', 'email'],
  })
  if (typeof payload.iat !== 'number' || payload.iat > Math.floor(Date.now() / 1_000)) {
    throw new Error('Cloudflare Access assertion is not valid yet')
  }
  if (
    typeof payload.sub !== 'string' ||
    !payload.sub ||
    typeof payload.email !== 'string' ||
    !payload.email
  ) {
    throw new Error('Cloudflare Access identity is missing')
  }
  return { subject: payload.sub, email: payload.email, issuer }
}

export function assertSameOrigin(origin: string | null, siteUrl: string): void {
  if (!origin || origin !== new URL(siteUrl).origin) {
    throw new Error('A same-origin request is required')
  }
}

export function isAdministratorPath(pathname: string): boolean {
  // Decode once before testing route boundaries; malformed encodings fail closed.
  const path = decodeURIComponent(pathname).replace(/\/{2,}/g, '/')
  return ['/admin', '/api/management', '/api/auth'].some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  )
}
