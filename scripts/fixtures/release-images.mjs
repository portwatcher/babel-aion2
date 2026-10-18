import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { until } from './media-worker.mjs'

const execute = promisify(execFile)
async function docker(args, environment = {}) {
  try {
    return await execute('docker', args, {
      env: { ...process.env, ...environment },
      timeout: 60_000,
      maxBuffer: 2_000_000,
    })
  } catch (error) {
    // Docker inspect/log output can include credentials; do not attach it.
    throw new Error(`Release fixture Docker ${args[0]} failed (${error.code})`)
  }
}

export async function releaseImages(previousImage, currentImage) {
  const images = new Map()
  for (const image of [previousImage, currentImage]) {
    assert.match(image ?? '', /@sha256:[a-f0-9]{64}$/)
    const [metadata] = JSON.parse((await docker(['image', 'inspect', image])).stdout)
    const source = metadata.Config.Labels?.['org.opencontainers.image.revision']
    assert.match(source ?? '', /^[a-f0-9]{40}$/)
    images.set(image, { source, platform: `linux/${metadata.Architecture}` })
  }
  assert.notEqual(previousImage, currentImage)
  const prefix = `babel-rollback-${randomUUID().slice(0, 8)}`
  const postgresName = `${prefix}-postgres`
  const adminPassword = randomBytes(24).toString('hex')
  const applicationPassword = randomBytes(24).toString('hex')
  const databaseName = 'rollback_application'
  let admin, pool, web, origin, applicationUrl
  let incarnation = 0
  async function ownedContainers() {
    return (await docker(['ps', '-a', '--format', '{{.Names}}'])).stdout
      .trim()
      .split('\n')
      .filter((name) => name.startsWith(`${prefix}-`))
  }
  async function stop() {
    if (!web) {
      return
    }
    await docker(['stop', '--time', '15', web])
    const exitCode = (
      await docker(['inspect', '--format', '{{.State.ExitCode}}', web])
    ).stdout.trim()
    await docker(['rm', web])
    web = undefined
    assert.equal(exitCode, '0', 'Published runtime must shut down cleanly')
  }
  async function close() {
    await pool?.end()
    await admin?.end()
    const containers = await ownedContainers()
    const ordered = containers.filter((name) => name !== postgresName)
    if (containers.includes(postgresName)) {
      ordered.push(postgresName)
    }
    for (const name of ordered) {
      await docker(['stop', '--time', '15', name])
      await docker(['rm', '-v', name])
    }
    assert.deepEqual(await ownedContainers(), [])
  }
  async function migrate(image) {
    await docker(
      [
        'run',
        '--rm',
        '--name',
        `${prefix}-migrate-${++incarnation}`,
        '--platform',
        images.get(image).platform,
        '--network',
        `container:${postgresName}`,
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges:true',
        '-e',
        'DATABASE_URL',
        image,
        'node',
        'database/migrate.mjs',
      ],
      { DATABASE_URL: applicationUrl },
    )
  }
  async function start(image, environment) {
    assert.equal(web, undefined, 'Stop the previous runtime first')
    const name = `${prefix}-web-${++incarnation}`
    const runtimeEnvironment = {
      ...environment,
      HOST: '0.0.0.0',
      PORT: '3000',
      NUXT_SITE_URL: origin,
      NUXT_DATABASE_URL: applicationUrl,
      NUXT_DATABASE_POOL_MAX: '2',
      NODE_OPTIONS: '--import=/fixture/access-jwks.mjs',
    }
    const preload = fileURLToPath(new URL('./access-jwks.mjs', import.meta.url))
    await docker(
      [
        'run',
        '-d',
        '--name',
        name,
        '--platform',
        images.get(image).platform,
        '--network',
        `container:${postgresName}`,
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges:true',
        '--tmpfs',
        '/tmp:rw,nosuid,size=64m',
        '--mount',
        `type=bind,src=${preload},dst=/fixture/access-jwks.mjs,readonly`,
        ...Object.keys(runtimeEnvironment).flatMap((key) => ['-e', key]),
        image,
      ],
      runtimeEnvironment,
    )
    web = name
    await until(
      async () => {
        try {
          return (
            await fetch(`${origin}/api/health/ready`, {
              signal: AbortSignal.timeout(1_000),
            })
          ).ok
        } catch {
          return false
        }
      },
      'published runtime readiness',
      30_000,
    )
    assert.equal((await docker(['exec', web, 'id', '-u'])).stdout.trim(), '1000')
  }
  try {
    await docker(
      [
        'run',
        '-d',
        '--name',
        postgresName,
        '-e',
        'POSTGRES_PASSWORD',
        '-p',
        '127.0.0.1::5432',
        '-p',
        '127.0.0.1::3000',
        '--tmpfs',
        '/var/lib/postgresql/data:rw,nosuid,size=256m',
        process.env.BABEL_TEST_POSTGRES_IMAGE ?? 'postgres:13-alpine',
      ],
      { POSTGRES_PASSWORD: adminPassword },
    )
    const ports = JSON.parse(
      (
        await docker([
          'inspect',
          '--format',
          '{{json .NetworkSettings.Ports}}',
          postgresName,
        ])
      ).stdout,
    )
    const databasePort = ports['5432/tcp'][0].HostPort
    origin = `http://127.0.0.1:${ports['3000/tcp'][0].HostPort}`
    admin = new pg.Pool({
      connectionString: `postgresql://postgres:${adminPassword}@127.0.0.1:${databasePort}/postgres`,
      max: 1,
    })
    await until(
      async () => {
        try {
          await admin.query('select 1')
          return true
        } catch {
          return false
        }
      },
      'disposable PostgreSQL readiness',
      30_000,
    )
    await admin.query(
      `create role rollback_app login password '${applicationPassword}' nosuperuser nocreatedb nocreaterole noreplication connection limit 8`,
    )
    await admin.query(`create database ${databaseName} owner rollback_app`)
    applicationUrl = `postgresql://rollback_app:${applicationPassword}@127.0.0.1:5432/${databaseName}`
    const url = new URL(applicationUrl)
    url.port = databasePort
    pool = new pg.Pool({ connectionString: url.toString(), max: 1 })
    return { pool, url: url.toString(), origin, images, migrate, start, stop, close }
  } catch (error) {
    await close()
    throw error
  }
}
