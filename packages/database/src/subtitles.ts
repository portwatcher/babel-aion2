import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import {
  providerSettingsSchema,
  type OpenAISettings,
  type SubtitleSubscription,
  type TerminologySnapshot,
} from '@babel/contracts'
import type { Database } from './client.ts'
import type { CredentialCipher } from './credentials.ts'
import {
  listenerSession,
  nickname,
  outputLanguage,
  providerConfiguration,
} from './schema/rooms.ts'
import { playerConnection } from './schema/player-connections.ts'
import { createTermService } from './terms.ts'
import { snapshot } from './listeners/model.ts'

export interface SubtitlePathStamp {
  code: string
  pathVersion: number
  recognitionId: string
  recognitionVersion: number
  translationId: string
  translationVersion: number
  terminologyVersion: number | null
}
export interface LiveSubtitlePath {
  stamp: SubtitlePathStamp
  recognition: { settings: OpenAISettings; credential: string }
  translation: { settings: OpenAISettings; credential: string }
  terminology: TerminologySnapshot | null
}

export async function readSubtitlePaths(db: Database, cipher: CredentialCipher) {
  const languages = await db
    .select()
    .from(outputLanguage)
    .where(
      and(eq(outputLanguage.enabled, true), isNotNull(outputLanguage.pathValidatedAt)),
    )
  if (!languages.length) {
    return []
  }
  const providers = await db.select().from(providerConfiguration)
  const terms = languages.some((language) => language.includeTerms)
    ? await createTermService(db).snapshot()
    : null
  const paths: LiveSubtitlePath[] = []
  for (const language of languages) {
    const recognition = providers.find(
      (value) => value.id === language.recognitionConfigurationId,
    )
    const translation = providers.find(
      (value) => value.id === language.translationConfigurationId,
    )
    const r = providerSettingsSchema.safeParse(recognition?.publicSettings)
    const t = providerSettingsSchema.safeParse(translation?.publicSettings)
    if (
      !recognition ||
      !translation ||
      !r.success ||
      !t.success ||
      r.data.type !== 'openai' ||
      t.data.type !== 'openai'
    ) {
      continue
    }
    try {
      paths.push({
        stamp: {
          code: language.code,
          pathVersion: language.pathVersion,
          recognitionId: recognition.id,
          recognitionVersion: recognition.version,
          translationId: translation.id,
          translationVersion: translation.version,
          terminologyVersion: language.includeTerms ? (terms?.version ?? null) : null,
        },
        recognition: {
          settings: r.data,
          credential: cipher.decrypt(
            recognition.encryptedCredential,
            `provider:${recognition.id}:credential`,
          ),
        },
        translation: {
          settings: t.data,
          credential: cipher.decrypt(
            translation.encryptedCredential,
            `provider:${translation.id}:credential`,
          ),
        },
        terminology: language.includeTerms ? terms : null,
      })
    } catch {
      // One invalid protected path cannot stop unrelated languages or original audio.
    }
  }
  return paths
}

function listenerQuery(db: Database, input: SubtitleSubscription) {
  return db
    .select({ listener: listenerSession })
    .from(playerConnection)
    .innerJoin(listenerSession, eq(listenerSession.id, playerConnection.sessionId))
    .innerJoin(nickname, eq(nickname.key, listenerSession.nicknameKey))
    .innerJoin(outputLanguage, eq(outputLanguage.code, listenerSession.outputLanguage))
    .where(
      and(
        eq(playerConnection.id, input.connectionId),
        isNull(playerConnection.closedAt),
        eq(playerConnection.nicknameGeneration, input.reference.nicknameGeneration),
        eq(listenerSession.id, input.reference.sessionId),
        eq(listenerSession.nicknameGeneration, input.reference.nicknameGeneration),
        eq(listenerSession.subscriptionVersion, input.subscriptionVersion),
        eq(listenerSession.state, 'ACTIVE'),
        isNull(listenerSession.revokedAt),
        eq(nickname.currentSessionId, listenerSession.id),
        eq(nickname.generation, listenerSession.nicknameGeneration),
        eq(outputLanguage.enabled, true),
        isNotNull(outputLanguage.pathValidatedAt),
      ),
    )
}

export async function readSubtitleListener(db: Database, input: SubtitleSubscription) {
  const [row] = await listenerQuery(db, input)
  return row ? snapshot(row.listener) : null
}

function pathQuery(roomId: string, generation: number, stamp: SubtitlePathStamp) {
  return sql`select 1 from room r
      join output_language l on l.code = ${stamp.code}
      join provider_configuration a on a.id = l.recognition_configuration_id
      join provider_configuration b on b.id = l.translation_configuration_id
      left join term_catalog t on t.id = 'global'
      where r.id = ${roomId} and r.source_generation = ${generation} and not r.stopped
        and l.enabled and l.path_validated_at is not null and l.path_version = ${stamp.pathVersion}
        and a.id = ${stamp.recognitionId} and a.version = ${stamp.recognitionVersion}
        and b.id = ${stamp.translationId} and b.version = ${stamp.translationVersion}
        and ((not l.include_terms and ${stamp.terminologyVersion}::integer is null)
          or (l.include_terms and t.version = ${stamp.terminologyVersion}))
  `
}

/** Validate both revocation fences in one database snapshot and one round trip. */
export async function subtitleDeliveryCurrent(
  db: Database,
  input: SubtitleSubscription,
  roomId: string,
  generation: number,
  stamp: SubtitlePathStamp,
) {
  const result = await db.execute<{ listener: boolean; path: boolean }>(sql`
    select exists (${listenerQuery(db, input)}) as listener,
           exists (${pathQuery(roomId, generation, stamp)}) as path`)
  return result.rows[0] ?? { listener: false, path: false }
}
