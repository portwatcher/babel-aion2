import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import type { GameTerm } from '@babel/contracts'

export const termCatalog = pgTable('term_catalog', {
  id: text('id').primaryKey(),
  version: integer('version').notNull().default(0),
})
export const gameTerm = pgTable(
  'game_term',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceTerm: text('source_term').notNull(),
    sourceLanguage: text('source_language').notNull(),
    alternatives: jsonb('alternatives').$type<string[]>().notNull().default([]),
    category: text('category').notNull(),
    expressions: jsonb('expressions').$type<GameTerm['expressions']>().notNull(),
    context: text('context').notNull().default(''),
    enabled: boolean('enabled').notNull().default(true),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('game_term_source_idx').on(table.sourceLanguage, table.sourceTerm),
  ],
)
