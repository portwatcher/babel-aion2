import { getRequestWebStream, type H3Event } from 'h3'

export class BodyInputError extends Error {
  constructor(readonly code: 'TOO_LARGE' | 'INVALID_JSON') {
    super(code)
  }
}

export async function readBoundedJson(
  event: H3Event,
  maximumBytes: number,
): Promise<unknown> {
  const reader = getRequestWebStream(event)?.getReader()
  if (!reader) {
    throw new BodyInputError('INVALID_JSON')
  }
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) {
        break
      }
      size += chunk.value.byteLength
      if (size > maximumBytes) {
        await reader.cancel()
        throw new BodyInputError('TOO_LARGE')
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new BodyInputError('INVALID_JSON')
  }
}
