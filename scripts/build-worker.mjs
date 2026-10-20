import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

await build({
  absWorkingDir: fileURLToPath(new URL('..', import.meta.url)),
  entryPoints: [
    'apps/voice-worker/src/index.ts',
    'apps/voice-worker/src/runtime.ts',
    // Media peers run in worker threads loaded from this sibling module.
    'apps/voice-worker/src/media-shard.ts',
  ],
  outdir: 'apps/voice-worker/dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: ['pg', 'ws', 'werift', 'discord.js', '@discordjs/voice', '@discordjs/opus'],
  // Bundled CommonJS dependencies (OpenTelemetry) require Node built-ins.
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
})
console.log('Built voice-worker media control service')
