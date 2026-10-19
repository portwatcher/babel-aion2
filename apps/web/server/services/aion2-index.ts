import { z } from 'zod'
import { characterRequestSchema, type CharacterProfile } from '@babel/contracts'

const resultSchema = z.object({
  suggestions: z
    .array(
      z.object({
        name: z.string(),
        href: z.string(),
        region: z.string(),
        server: z.string(),
        className: z.string(),
        level: z.number(),
      }),
    )
    .max(100),
})

export class CharacterLookupError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'UNAVAILABLE') {
    super(code)
  }
}

// The public API used by AION2 Index's own character search. Never accept a
// destination URL, regional redirect or client-supplied profile as verification.
export async function lookupCharacter(input: unknown): Promise<CharacterProfile> {
  const { nickname, server } = characterRequestSchema.parse(input)
  const url = new URL('https://aion2index.com/api/search/suggest')
  url.searchParams.set('q', nickname)
  url.searchParams.set('region', 'as')
  let result: z.infer<typeof resultSchema>
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'Babel-AION2/0.1' },
      redirect: 'error',
      signal: AbortSignal.timeout(8_000),
    })
    if (!response.ok) {
      throw new Error('Index unavailable')
    }
    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('Empty index response')
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
          throw new Error('Index response too large')
        }
        chunks.push(next.value)
      }
    } finally {
      reader.releaseLock()
    }
    result = resultSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  } catch {
    throw new CharacterLookupError('UNAVAILABLE')
  }
  const character = result.suggestions.find((candidate) => {
    if (
      candidate.name.normalize('NFC') !== nickname.normalize('NFC') ||
      candidate.region !== 'as'
    ) {
      return false
    }
    try {
      const segments = candidate.href.split('/').map(decodeURIComponent)
      return (
        segments.length === 5 &&
        segments[0] === '' &&
        segments[1] === 'c' &&
        segments[2] === 'as' &&
        segments[3] === server &&
        segments[4]?.normalize('NFC') === nickname.normalize('NFC')
      )
    } catch {
      return false
    }
  })
  if (!character) {
    throw new CharacterLookupError('NOT_FOUND')
  }
  return {
    nickname: character.name,
    server,
    region: 'as',
    profileUrl: `https://aion2index.com/c/as/${server}/${encodeURIComponent(character.name)}`,
    description: `${character.server} · ${character.className} · Lv ${character.level}`,
  }
}
