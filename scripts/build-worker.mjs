import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: ['apps/voice-worker/src/index.ts', 'apps/voice-worker/src/runtime.ts'],
  outdir: 'apps/voice-worker/dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: ['pg', 'werift', 'discord.js', '@discordjs/voice', '@discordjs/opus'],
})
console.log('Built voice-worker media control service')
