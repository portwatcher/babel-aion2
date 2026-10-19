import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import type { CharacterProfile, MapPoint, MapStrokeInput } from '@babel/contracts'
import { listenerSession, room } from './rooms.ts'

export const roomInstallation = pgTable('room_installation', {
  id: uuid('id').primaryKey().defaultRandom(),
  stateHash: text('state_hash').notNull().unique(),
  browserHash: text('browser_hash').notNull(),
  name: text('name').notNull(),
  server: text('server').notNull(),
  allowedIds: jsonb('allowed_ids').$type<string[]>().notNull().default([]),
  guildId: text('guild_id'),
  creatorId: text('creator_id'),
  hostId: text('host_id'),
  consumedRoomId: uuid('consumed_room_id').references(() => room.id),
  authorizedAt: timestamp('authorized_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

export const communityRoom = pgTable('community_room', {
  roomId: uuid('room_id')
    .primaryKey()
    .references(() => room.id, { onDelete: 'cascade' }),
  number: integer('number').notNull().generatedAlwaysAsIdentity().unique(),
  // Null for player-source rooms, which have no Discord installation.
  guildId: text('guild_id'),
  creatorId: text('creator_id'),
  server: text('server').notNull(),
  allowedIds: jsonb('allowed_ids').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const listenerCharacter = pgTable('listener_character', {
  sessionId: uuid('session_id')
    .primaryKey()
    .references(() => listenerSession.id, { onDelete: 'cascade' }),
  profile: jsonb('profile').$type<CharacterProfile>().notNull(),
})

export const mapStroke = pgTable(
  'map_stroke',
  {
    id: uuid('id').primaryKey(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => room.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => listenerSession.id, { onDelete: 'cascade' }),
    nickname: text('nickname').notNull(),
    color: text('color').$type<MapStrokeInput['color']>().notNull(),
    points: jsonb('points').$type<MapPoint[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('map_stroke_room_idx').on(table.roomId, table.createdAt)],
)
