import { z } from 'zod'

// RFC 7064/7065 destinations. No userinfo, paths, fragments or arbitrary queries.
export const iceUrlSchema = z
  .string()
  .max(512)
  .refine((value) => {
    const match =
      /^(stun|turn|turns):([a-zA-Z0-9.\-[\]:]+)(?:\?transport=(udp|tcp))?$/.exec(value)
    if (
      !match ||
      (match[1] === 'stun' && match[3]) ||
      (match[1] === 'turns' && match[3] === 'udp')
    ) {
      return false
    }
    try {
      const address = new URL(`http://${match[2]}`)
      return Boolean(address.hostname) && (!address.port || Number(address.port) > 0)
    } catch {
      return false
    }
  }, 'Invalid ICE service URL')

export const mediaIceConfigurationSchema = z
  .object({
    servers: z
      .array(
        z
          .object({
            urls: z.array(iceUrlSchema).min(1).max(4),
            username: z.string().min(1).max(256).optional(),
            credential: z.string().min(1).max(512).optional(),
          })
          .strict(),
      )
      .max(4),
    policy: z.enum(['all', 'relay']),
    // Relative duration avoids relying on the player's wall clock for renewal.
    renewAfterMs: z.number().int().min(1_000).max(86_400_000).nullable(),
  })
  .strict()

export type MediaIceConfiguration = z.infer<typeof mediaIceConfigurationSchema>
