import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['apps/voice-worker/src/index.ts'],
  outfile: 'apps/voice-worker/dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: ['pg', 'werift'],
})
console.log('Built voice-worker media control service')
