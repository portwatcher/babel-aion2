import { z } from 'zod'

export const NICKNAME_MAX_LENGTH = 32
export const ENTRY_NOTICE =
  '进入后，你的昵称会显示在在线名单中。同昵称的新入场会使旧连接退出。'
export const REPLACEMENT_NOTICE = '此昵称已在其他页面进入，你已退出收听。'

export const nicknameSchema = z
  .string()
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), '昵称不能包含控制字符')
  .transform((value) => value.trim())
  .refine((value) => [...value].length > 0, '请输入游戏昵称')
  .refine(
    (value) => [...value].length <= NICKNAME_MAX_LENGTH,
    `昵称最多 ${NICKNAME_MAX_LENGTH} 个字符`,
  )

export function nicknameKey(nickname: string): string {
  return nicknameSchema.parse(nickname).normalize('NFC')
}

export const entryRequestSchema = z.object({
  nickname: nicknameSchema,
  outputLanguage: z.string().nullable(),
  requestId: z.uuid(),
})
