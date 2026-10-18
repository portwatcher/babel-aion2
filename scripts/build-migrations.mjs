import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('..', import.meta.url))
await mkdir(new URL('../packages/database/dist', import.meta.url), { recursive: true })
await build({
  absWorkingDir: root,
  entryPoints: ['packages/database/src/migrate.ts'],
  outfile: 'packages/database/dist/migrate.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: ['pg-native'],
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
})
console.log('Built standalone PostgreSQL migration runner')
