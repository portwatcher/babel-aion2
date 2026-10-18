import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['apps/web/runtime/supervisor.ts', 'apps/web/runtime/runtime.ts'],
  outdir: 'apps/web/.output/server',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: ['pg-native'],
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
})
console.log('Built supervised web entry point')
