import {
  createCipheriv,
  createDecipheriv,
  createSecretKey,
  randomBytes,
} from 'node:crypto'

export class CredentialProtectionError extends Error {
  constructor() {
    super('Credential protection unavailable')
  }
}

export function createCredentialCipher(encodedKey: string) {
  const decoded = Buffer.from(encodedKey.trim(), 'base64')
  if (decoded.length !== 32 || decoded.toString('base64') !== encodedKey.trim()) {
    throw new CredentialProtectionError()
  }
  const key = createSecretKey(decoded)
  decoded.fill(0)

  return {
    encrypt(credential: string, context: string) {
      const nonce = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, nonce)
      cipher.setAAD(Buffer.from(`babel:credential:v1:${context}`))
      const ciphertext = Buffer.concat([
        cipher.update(credential, 'utf8'),
        cipher.final(),
      ])
      return [
        'v1',
        nonce.toString('base64url'),
        ciphertext.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
      ].join('.')
    },
    decrypt(envelope: string, context: string) {
      try {
        const parts = envelope.split('.')
        if (parts.length !== 4 || parts[0] !== 'v1') {
          throw new CredentialProtectionError()
        }
        const values = parts.slice(1).map((value) => {
          const bytes = Buffer.from(value, 'base64url')
          if (bytes.toString('base64url') !== value) {
            throw new CredentialProtectionError()
          }
          return bytes
        })
        const [nonce, ciphertext, tag] = values
        if (
          !nonce ||
          nonce.length !== 12 ||
          !ciphertext?.length ||
          ciphertext.length > 4096 ||
          !tag ||
          tag.length !== 16
        ) {
          throw new CredentialProtectionError()
        }
        const decipher = createDecipheriv('aes-256-gcm', key, nonce)
        decipher.setAAD(Buffer.from(`babel:credential:v1:${context}`))
        decipher.setAuthTag(tag)
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
          'utf8',
        )
      } catch {
        // Never expose cryptographic input, plaintext, keys or nested error causes.
        throw new CredentialProtectionError()
      }
    },
  }
}

export type CredentialCipher = ReturnType<typeof createCredentialCipher>
