import { spawn } from 'node:child_process'
import dgram from 'node:dgram'
import { once } from 'node:events'

export async function startOpusSource(receive) {
  const socket = dgram.createSocket('udp4')
  socket.bind(0, '127.0.0.1')
  await once(socket, 'listening')
  socket.on('message', receive)
  const encoder = spawn(
    process.env.FFMPEG_PATH || 'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-re',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000',
      '-ac',
      '2',
      '-c:a',
      'libopus',
      '-application',
      'lowdelay',
      '-frame_duration',
      '20',
      '-b:a',
      '64000',
      '-f',
      'rtp',
      `rtp://127.0.0.1:${socket.address().port}?pkt_size=1200`,
    ],
    { stdio: 'ignore' },
  )
  // Keep an error handler installed, including when the executable is absent.
  let encoderError
  encoder.on('error', (error) => {
    encoderError = error
  })
  const ended = new Promise((resolve) => encoder.once('close', resolve))
  return {
    failed: () => Boolean(encoderError || encoder.exitCode !== null),
    async close() {
      socket.close()
      encoder.kill('SIGTERM')
      const deadline = setTimeout(() => encoder.kill('SIGKILL'), 2_000)
      await ended
      clearTimeout(deadline)
    },
  }
}
