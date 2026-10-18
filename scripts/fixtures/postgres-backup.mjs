import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

// Real PostgreSQL utilities, with credentials only in the subprocess environment.
// Docker mode uses the matching tools inside an explicitly selected local fixture.
export async function postgresTool(url, tool, args, input) {
  const target = new URL(url)
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))
  const container = process.env.BABEL_TEST_POSTGRES_CONTAINER
  if (container) {
    assert.match(container, /^babel-[a-z0-9_-]+$/)
  }
  const environment = {
    ...process.env,
    PGHOST: container ? '127.0.0.1' : target.hostname,
    PGPORT: container ? '5432' : target.port || '5432',
    PGUSER: decodeURIComponent(target.username),
    PGPASSWORD: decodeURIComponent(target.password),
    PGDATABASE: decodeURIComponent(target.pathname.slice(1)),
  }
  const command = container ? 'docker' : tool
  const parameters = container
    ? [
        'exec',
        '-i',
        ...['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'].flatMap(
          (name) => ['-e', name],
        ),
        container,
        tool,
        ...args,
      ]
    : args
  const child = spawn(command, parameters, { env: environment, stdio: 'pipe' })
  const output = []
  let bytes = 0
  child.stdout.on('data', (chunk) => {
    bytes += chunk.length
    if (bytes > 8 * 1024 * 1024) {
      child.kill('SIGKILL')
    } else {
      output.push(chunk)
    }
  })
  child.stderr.resume()
  child.stdin.on('error', () => {})
  child.stdin.end(input)
  const deadline = setTimeout(() => child.kill('SIGKILL'), 30_000)
  try {
    const [code] = await once(child, 'exit')
    if (code !== 0 || bytes > 8 * 1024 * 1024) {
      throw new Error(`PostgreSQL ${tool} did not complete`)
    }
    return Buffer.concat(output)
  } finally {
    clearTimeout(deadline)
  }
}

export async function assertMatchingPostgresTools(database) {
  const { rows } = await database.pool.query('show server_version_num')
  const major = Math.floor(Number(rows[0].server_version_num) / 10_000)
  for (const tool of ['pg_dump', 'pg_restore']) {
    const version = (await postgresTool(database.url, tool, ['--version'])).toString()
    assert.equal(
      Number(version.match(/PostgreSQL\) (\d+)\./)?.[1]),
      major,
      'Use PostgreSQL tools matching the fixture server major version',
    )
  }
  return major
}
