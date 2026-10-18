import { readdir, readFile } from 'node:fs/promises'
import { extname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const extensions = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.vue',
  '.css',
  '.scss',
])
const ignored = new Set([
  'node_modules',
  '.nuxt',
  '.output',
  'dist',
  'coverage',
  'migrations',
])
let failures = 0
let count = 0
let largest = { path: '', lines: 0 }

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) {
      continue
    }
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      await walk(path)
    } else if (extensions.has(extname(path)) && !/\.config\.[^.]+$/.test(path)) {
      const contents = await readFile(path, 'utf8')
      const lines = contents.split('\n').length - Number(contents.endsWith('\n'))
      const name = relative(root, path)
      count += 1
      if (lines > largest.lines) {
        largest = { path: name, lines }
      }
      if (lines > 800) {
        console.error(`FAIL ${name}: ${lines} lines (maximum 800)`)
        failures += 1
      } else if (lines >= 600) {
        console.warn(`WARN ${name}: ${lines} lines (preferred below 600)`)
      }
    }
  }
}

for (const path of ['apps', 'packages', 'scripts']) {
  await walk(resolve(root, path))
}
console.log(
  `Checked ${count} source files. Largest: ${largest.path} (${largest.lines} lines).`,
)
process.exitCode = failures ? 1 : 0
