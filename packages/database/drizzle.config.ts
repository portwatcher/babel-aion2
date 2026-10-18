import { defineConfig } from 'drizzle-kit'
import { existsSync } from 'node:fs'

if (existsSync('.env')) {
  process.loadEnvFile('.env')
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './packages/database/src/schema/*.ts',
  out: './packages/database/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
})
