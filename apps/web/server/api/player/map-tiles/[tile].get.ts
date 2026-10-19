// Extract only the requested public map tile. Fixed host/path and bounded
// coordinates prevent this endpoint from becoming an arbitrary URL proxy.
const cache = new Map<string, { bytes: Buffer; expiresAt: number }>()
const pending = new Map<string, Promise<Buffer>>()
let cacheBytes = 0
const maximumCacheBytes = 32 * 1024 * 1024

async function originalTile(tile: string) {
  const cached = cache.get(tile)
  if (cached && cached.expiresAt > Date.now()) {
    cache.delete(tile)
    cache.set(tile, cached)
    return cached.bytes
  }
  if (cached) {
    cacheBytes -= cached.bytes.byteLength
    cache.delete(tile)
  }
  const existing = pending.get(tile)
  if (existing) {
    return existing
  }
  if (pending.size >= 32) {
    throw new Error('Tile queue full')
  }
  const task = (async () => {
    const response = await fetch(
      `https://interactivemap.app/aion2/maps/imapp/uploads/tiles/abyssa/${tile}`,
      {
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      },
    )
    if (
      !response.ok ||
      !response.headers.get('content-type')?.startsWith('image/jpeg')
    ) {
      throw new Error('Tile unavailable')
    }
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Empty tile')
    }
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) {
          break
        }
        size += next.value.byteLength
        if (size > 128 * 1024) {
          await reader.cancel()
          throw new Error('Tile too large')
        }
        chunks.push(next.value)
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = Buffer.concat(chunks)
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      throw new Error('Invalid tile image')
    }
    while (cache.size >= 512 || cacheBytes + bytes.byteLength > maximumCacheBytes) {
      const oldest = cache.keys().next().value
      if (!oldest) {
        break
      }
      cacheBytes -= cache.get(oldest)!.bytes.byteLength
      cache.delete(oldest)
    }
    cache.set(tile, { bytes, expiresAt: Date.now() + 6 * 60 * 60_000 })
    cacheBytes += bytes.byteLength
    return bytes
  })()
  pending.set(tile, task)
  try {
    return await task
  } finally {
    pending.delete(tile)
  }
}

export default defineEventHandler(async (event) => {
  const tile = getRouterParam(event, 'tile') ?? ''
  const match = /^(\d{1})_(\d{1,3})_(\d{1,3})\.jpg$/.exec(tile)
  if (
    !match ||
    Number(match[1]) > 7 ||
    Number(match[2]) >= 2 ** Number(match[1]) ||
    Number(match[3]) >= 2 ** Number(match[1])
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid map tile' })
  }
  try {
    const bytes = await originalTile(tile)
    setResponseHeaders(event, {
      'content-type': 'image/jpeg',
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff',
    })
    return bytes
  } catch {
    throw createError({
      statusCode: 502,
      statusMessage: 'Map tile temporarily unavailable',
    })
  }
})
