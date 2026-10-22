import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { brotliDecompressSync, createBrotliDecompress } from 'node:zlib'

const expectedVersion =
  process.argv[2] ?? readFileSync(new URL('../.nvmrc', import.meta.url), 'utf8').trim()
assert.equal(process.versions.node, expectedVersion, 'Use the pinned Node runtime')

// Node's CVE-2026-111497 regression: a stream with only one block type must
// reject a block switch. Keep the fixed error literal independent of the binary.
// https://github.com/nodejs/node/commit/b5f41529df
const invalidBlockSwitch = Buffer.from(
  '200010414141fcffff07002228f00b60f7f41f000000',
  'hex',
)
const expectedError = { code: 'ERR__ERROR_FORMAT_BLOCK_SWITCH', errno: -17 }
assert.throws(() => brotliDecompressSync(invalidBlockSwitch), expectedError)

const decoder = createBrotliDecompress()
const failure = once(decoder, 'error')
decoder.resume()
for (const byte of invalidBlockSwitch) {
  decoder.write(Buffer.from([byte]))
}
decoder.end()
const [error] = await failure
assert.equal(error.code, expectedError.code)
assert.equal(error.errno, expectedError.errno)
console.log(`PASS Node ${expectedVersion}: CVE-2026-111497 sync and stream rejection`)
