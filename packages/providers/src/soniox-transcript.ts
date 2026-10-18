import { randomUUID } from 'node:crypto'
import type { Transcript } from '@babel/contracts'
import { z } from 'zod'
import { ProviderFailure } from './errors.ts'

const tokenSchema = z.object({
  text: z.string().max(4096),
  is_final: z.boolean(),
  start_ms: z.number().nonnegative().optional(),
  end_ms: z.number().nonnegative().optional(),
  language: z.string().min(2).max(35).optional(),
  translation_status: z.string().optional(),
})
export const sonioxResponseSchema = z.object({
  tokens: z.array(tokenSchema).max(4096).optional(),
  error_code: z.number().optional(),
  error_type: z.string().optional(),
  finished: z.boolean().optional(),
  total_audio_proc_ms: z.number().nonnegative().optional(),
})
type Token = z.infer<typeof tokenSchema>

// Soniox sends final tokens once. Each response replaces all provisional tokens.
// An endpoint closes the utterance, while token timestamps remain provider data.
export function createSonioxTranscript(onTranscript: (value: Transcript) => void) {
  let finalized: Token[] = []
  let provisional: Token[] = []
  let utteranceId = randomUUID()
  let revision = 0
  let previous = ''
  function emit(isFinal: boolean) {
    const tokens = [...finalized, ...provisional]
    const text = tokens.map((token) => token.text).join('')
    if (text.length > 4096 || tokens.length > 4096) {
      throw new ProviderFailure('INVALID_RESPONSE')
    }
    if (!text && !previous) {
      return
    }
    const languages = [
      ...new Set(tokens.flatMap((token) => (token.language ? [token.language] : []))),
    ]
    let language = 'und'
    if (languages.length === 1 && languages[0]) {
      try {
        language = new Intl.Locale(languages[0]).baseName
      } catch {
        throw new ProviderFailure('INVALID_RESPONSE')
      }
    }
    const value = {
      text,
      language,
      isFinal,
      audioStartMs: tokens[0]?.start_ms ?? null,
      audioEndMs: tokens.at(-1)?.end_ms ?? null,
    }
    const key = JSON.stringify(value)
    if (key === previous) {
      return
    }
    previous = key
    revision += 1
    onTranscript({ utteranceId, revision, ...value })
  }
  function endpoint() {
    emit(true)
    finalized = []
    provisional = []
    utteranceId = randomUUID()
    revision = 0
    previous = ''
  }
  return {
    accept(tokens: Token[] | undefined, finished: boolean) {
      if (tokens) {
        provisional = []
        for (const token of tokens) {
          if (
            token.translation_status &&
            !['none', 'original'].includes(token.translation_status)
          ) {
            throw new ProviderFailure('INVALID_RESPONSE')
          }
          if (
            token.start_ms !== undefined &&
            token.end_ms !== undefined &&
            token.end_ms < token.start_ms
          ) {
            throw new ProviderFailure('INVALID_RESPONSE')
          }
          if (token.text === '<end>' || token.text === '<fin>') {
            if (!token.is_final || provisional.length) {
              throw new ProviderFailure('INVALID_RESPONSE')
            }
            endpoint()
          } else if (token.is_final) {
            if (provisional.length) {
              throw new ProviderFailure('INVALID_RESPONSE')
            }
            finalized.push(token)
          } else {
            provisional.push(token)
          }
          if (finalized.length + provisional.length > 4096) {
            throw new ProviderFailure('INVALID_RESPONSE')
          }
        }
      }
      if (finished) {
        if (provisional.length) {
          throw new ProviderFailure('INVALID_RESPONSE')
        }
        endpoint()
      } else {
        emit(false)
      }
    },
  }
}
