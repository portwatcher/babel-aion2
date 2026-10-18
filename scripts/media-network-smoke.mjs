import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createCoturnFixture } from './fixtures/coturn.mjs'

const turn = await createCoturnFixture()
let child
try {
  child = spawn(
    process.execPath,
    ['--import', 'tsx', '--test', 'apps/voice-worker/test/media-network.test.mjs'],
    {
      env: {
        ...process.env,
        NODE_EXTRA_CA_CERTS: turn.cert,
        BABEL_TEST_TURN: JSON.stringify(turn),
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    },
  )
  const deadline = setTimeout(() => child.kill('SIGTERM'), 150_000)
  const force = setTimeout(() => child.kill('SIGKILL'), 155_000)
  const [code] = await once(child, 'exit')
  clearTimeout(deadline)
  clearTimeout(force)
  assert.equal(code, 0, 'Real media network test failed')
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM')
    await once(child, 'exit')
  }
  await turn.close()
}
