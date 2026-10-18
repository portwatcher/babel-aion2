import { sql } from 'drizzle-orm'
import type {
  ProviderTestResult,
  TerminalReason,
  LanguageValidation,
} from '@babel/contracts'
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const listenerState = pgEnum('listener_state', [
  'JOINING',
  'ACTIVE',
  'DISCONNECTING',
  'REPLACED',
  'REMOVED',
  'EXPIRED',
])
export const discordCaptureMode = pgEnum('discord_capture_mode', [
  'SELECTED_USERS',
  'ALL_CHANNEL',
])

export const room = pgTable('room', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  stopped: boolean('stopped').notNull().default(true),
  sourceGeneration: bigint('source_generation', { mode: 'number' })
    .notNull()
    .default(0),
  defaultOutputLanguage: text('default_output_language'),
  configurationVersion: integer('configuration_version').notNull().default(1),
  discordGuildId: text('discord_guild_id'),
  discordVoiceChannelId: text('discord_voice_channel_id'),
  captureMode: discordCaptureMode('capture_mode').notNull().default('SELECTED_USERS'),
  commanderIds: jsonb('commander_ids').$type<string[]>().notNull().default([]),
  encryptedDiscordCredential: text('encrypted_discord_credential'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// All lifecycle mutations lock this global key before changing a session.
export const nickname = pgTable('nickname', {
  key: text('key').primaryKey(),
  generation: bigint('generation', { mode: 'number' }).notNull().default(0),
  currentSessionId: uuid('current_session_id'),
})

export const listenerSession = pgTable(
  'listener_session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => room.id),
    nickname: text('nickname').notNull(),
    nicknameKey: text('nickname_key')
      .notNull()
      .references(() => nickname.key),
    nicknameGeneration: bigint('nickname_generation', { mode: 'number' }).notNull(),
    requestId: uuid('request_id').notNull().unique(),
    requestFingerprint: text('request_fingerprint').notNull(),
    credentialHash: text('credential_hash').notNull().unique(),
    state: listenerState('state').notNull().default('JOINING'),
    outputLanguage: text('output_language'),
    subscriptionVersion: integer('subscription_version').notNull().default(0),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    deliveryStoppedAt: timestamp('delivery_stopped_at', { withTimezone: true }),
    terminalReason: text('terminal_reason').$type<TerminalReason>(),
  },
  (table) => [
    index('listener_room_idx').on(table.roomId),
    uniqueIndex('one_active_nickname_idx')
      .on(table.nicknameKey)
      .where(sql`${table.state} = 'ACTIVE'`),
  ],
)

export const providerConfiguration = pgTable('provider_configuration', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  providerType: text('provider_type').notNull(),
  purpose: text('purpose').notNull(),
  encryptedCredential: text('encrypted_credential').notNull(),
  publicSettings: jsonb('public_settings').notNull().default({}),
  enabled: boolean('enabled').notNull().default(false),
  version: integer('version').notNull().default(1),
  lastTest: jsonb('last_test').$type<ProviderTestResult>(),
  testLeaseId: uuid('test_lease_id'),
  testLeaseUntil: timestamp('test_lease_until', { withTimezone: true }),
  lastTestStartedAt: timestamp('last_test_started_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const providerRevision = pgTable(
  'provider_revision',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    configurationId: uuid('configuration_id')
      .notNull()
      .references(() => providerConfiguration.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    name: text('name').notNull(),
    settings: jsonb('settings').notNull(),
    encryptedCredential: text('encrypted_credential').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('provider_revision_version_idx').on(
      table.configurationId,
      table.version,
    ),
  ],
)

export const outputLanguage = pgTable('output_language', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  order: integer('sort_order').notNull().default(0),
  recognitionConfigurationId: uuid('recognition_configuration_id').references(
    () => providerConfiguration.id,
  ),
  translationConfigurationId: uuid('translation_configuration_id').references(
    () => providerConfiguration.id,
  ),
  pathValidatedAt: timestamp('path_validated_at', { withTimezone: true }),
  version: integer('version').notNull().default(1),
  pathVersion: integer('path_version').notNull().default(1),
  includeTerms: boolean('include_terms').notNull().default(true),
  validation: jsonb('validation').$type<LanguageValidation>(),
  lastAttempt: jsonb('last_attempt').$type<LanguageValidation>(),
})

export const languageCatalog = pgTable('language_catalog', {
  id: text('id').primaryKey(),
  version: integer('version').notNull().default(0),
})

export const auditEvent = pgTable('audit_event', {
  id: uuid('id').primaryKey().defaultRandom(),
  actorSubject: text('actor_subject').notNull(),
  action: text('action').notNull(),
  resourceId: text('resource_id'),
  // Store identifiers and versions only. Never store request bodies or secrets.
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
