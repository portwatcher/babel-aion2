import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { until } from './media-worker.mjs'

const exec = promisify(execFile)
const image =
  'coturn/coturn:4.18.0-r0@sha256:bbefd3e1fdfdc0d58770fe01b581fd8b00d9f3a5580d00acb77cf719a6bc78e3'

// Both endpoints use this real relay. Relay-to-relay traffic stays inside Docker;
// no host relay range, external address discovery or loopback-peer exception.
export async function createCoturnFixture() {
  await mkdir('.local', { recursive: true })
  const directory = await mkdtemp(resolve('.local/babel-turn-'))
  const name = `babel-turn-${randomBytes(6).toString('hex')}`
  const secret = randomBytes(32).toString('base64url')
  const cert = `${directory}/cert.pem`
  let started = false
  async function close() {
    if (started) {
      await exec('docker', ['rm', '--force', name])
      started = false
    }
    await rm(directory, { recursive: true, force: true })
  }
  try {
    await exec('openssl', [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=Babel isolated TURN test',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
      '-keyout',
      `${directory}/key.pem`,
      '-out',
      cert,
    ])
    await writeFile(
      `${directory}/turn.conf`,
      [
        'listening-port=3478',
        'tls-listening-port=5349',
        'listening-ip=0.0.0.0',
        'relay-ip=0.0.0.0',
        'min-port=43300',
        'max-port=43363',
        'relay-threads=1',
        'realm=babel-test.invalid',
        'use-auth-secret',
        `static-auth-secret=${secret}`,
        'fingerprint',
        'no-cli',
        'no-multicast-peers',
        'no-software-attribute',
        'cert=/fixture/cert.pem',
        'pkey=/fixture/key.pem',
        'log-file=stdout',
        'pidfile=/tmp/coturn.pid',
      ].join('\n'),
      { mode: 0o600 },
    )
    await exec('docker', [
      'run',
      '--detach',
      '--name',
      name,
      '--user',
      '0:0',
      '--entrypoint',
      'turnserver',
      '--cap-drop',
      'ALL',
      '--cap-add',
      'NET_BIND_SERVICE',
      '--security-opt',
      'no-new-privileges',
      '--read-only',
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=16m',
      '-p',
      '127.0.0.1::3478/udp',
      '-p',
      '127.0.0.1::3478/tcp',
      '-p',
      '127.0.0.1::5349/tcp',
      '--mount',
      `type=bind,source=${directory},target=/fixture,readonly`,
      image,
      '-c',
      '/fixture/turn.conf',
    ])
    started = true
    const result = await exec('docker', ['inspect', name])
    const info = JSON.parse(result.stdout)[0]
    const port = (key) => {
      const binding = info.NetworkSettings.Ports[key]?.[0]
      assert.equal(binding?.HostIp, '127.0.0.1')
      return binding.HostPort
    }
    await until(async () => {
      const log = await exec('docker', ['logs', name])
      return (log.stdout + log.stderr).includes('Relay ports initialization done')
    }, 'isolated Coturn ready')
    return {
      cert,
      secret,
      close,
      udp: `turn:127.0.0.1:${port('3478/udp')}?transport=udp`,
      tcp: `turn:127.0.0.1:${port('3478/tcp')}?transport=tcp`,
      tls: `turns:127.0.0.1:${port('5349/tcp')}?transport=tcp`,
      stun: `stun:127.0.0.1:${port('3478/udp')}`,
    }
  } catch {
    await close()
    throw new Error('Isolated Coturn fixture could not start')
  }
}
