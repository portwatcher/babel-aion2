import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'

const candidate = process.argv[2]
if (!['werift', 'wrtc', 'livekit'].includes(candidate)) {
  throw new Error('Choose werift, wrtc or livekit')
}
const child = spawn(
  process.execPath,
  [fileURLToPath(new URL(`./${candidate}.mjs`, import.meta.url))],
  {
    // Native SDK logs can include SDP, credentials and local addresses. Only the
    // controlled result sent over IPC is allowed into this command's output.
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    detached: process.platform !== 'win32',
    env: { ...process.env, NODE_ENV: 'production' },
  },
)
let result
let timedOut = false
let forceStop
function terminate(signal) {
  try {
    if (process.platform === 'win32') {
      child.kill(signal)
    } else {
      // The child has its own process group. Include its synthetic encoder if
      // a native SDK hangs; never signal the shared Codex/tool process group.
      process.kill(-child.pid, signal)
    }
  } catch (error) {
    if (error.code !== 'ESRCH') {
      throw error
    }
  }
}
child.on('message', (message) => {
  result = message
})
const deadline = setTimeout(() => {
  timedOut = true
  terminate('SIGTERM')
  forceStop = setTimeout(() => terminate('SIGKILL'), 2_000)
}, 45_000)
const [code, signal] = await once(child, 'exit')
clearTimeout(deadline)
clearTimeout(forceStop)
const checksPassed =
  candidate === 'wrtc' ? result?.stoppedTrack === true : result?.status === 'PASS'
const passed = code === 0 && !signal && !timedOut && checksPassed
console.log(
  JSON.stringify({
    candidate,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    result,
    exitCode: code,
    signal,
    timedOut,
    status: passed ? 'PASS' : 'FAIL',
  }),
)
process.exitCode = passed ? 0 : 1
