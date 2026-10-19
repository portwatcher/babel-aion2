import { z } from 'zod'

export const NICKNAME_MAX_LENGTH = 32
export const nicknameSchema = z
  .string()
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), 'nicknameControl')
  .transform((value) => value.trim())
  .refine((value) => [...value].length > 0, 'nicknameRequired')
  .refine((value) => [...value].length <= NICKNAME_MAX_LENGTH, 'nicknameTooLong')

export function nicknameKey(nickname: string): string {
  return nicknameSchema.parse(nickname).normalize('NFC')
}

export const entryRequestSchema = z.object({
  nickname: nicknameSchema,
  outputLanguage: z.string().nullable(),
  requestId: z.uuid(),
})
