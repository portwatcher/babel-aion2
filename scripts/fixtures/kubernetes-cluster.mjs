import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

export const finalizer = 'babel.juryquinn.com/runtime-ownership'
const supervised = 'babel.juryquinn.com/supervised'

export function command(file, args, input) {
  try {
    return execFileSync(file, args, {
      input,
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    throw new Error(`${file} ${args[0]} failed in isolated Kubernetes proof`)
  }
}

async function availablePort() {
  const server = createServer().listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

export async function kubernetesFixture(context, webImage, voiceImage) {
  assert.match(context, /^babel-(runtime|recovery)-[a-z0-9-]+$/)
  const profile = JSON.parse(
    command('minikube', ['profile', 'list', '-o', 'json']),
  ).valid.find((item) => item.Name === context)
  assert.equal(
    profile?.Config?.Driver,
    'docker',
    'Only a dedicated local Docker minikube profile is supported',
  )
  for (const image of [webImage, voiceImage]) {
    assert.match(
      image,
      /^babel-runtime-proof:[a-z0-9-]+$/,
      'Use explicitly built local proof images',
    )
  }
  const runId = randomBytes(6).toString('hex')
  const namespace = `babel-recovery-${runId}`
  const kube = (args, input) =>
    command('kubectl', ['--context', context, '-n', namespace, ...args], input)
  const nodes = JSON.parse(kube(['get', 'nodes', '-o', 'json'])).items
  assert.equal(nodes.length, 2)
  assert.ok(
    nodes.every((node) => [context, `${context}-m02`].includes(node.metadata.name)),
  )
  const previous = JSON.parse(
    kube(['get', 'pods', '--all-namespaces', '-o', 'json']),
  ).items
  assert.ok(
    previous.every((pod) => pod.metadata.namespace === 'kube-system'),
    'The profile must contain no other workloads; this test suspends its worker kubelet',
  )
  // A kubelet port-forward cannot independently prove liveness while kubelet is stopped.
  const published = command('docker', ['port', context, '32443/tcp']).trim()
  assert.match(published, /^127\.0\.0\.1:\d+$/)
  const ports = {
    database: await availablePort(),
    web: Number(published.split(':')[1]),
    stable: await availablePort(),
  }
  const origin = `http://127.0.0.1:${ports.stable}`
  const password = randomBytes(24).toString('hex')
  const forwards = new Map()
  const metadata = (name) => ({
    name,
    namespace,
    labels: { 'babel-recovery-test': runId, app: name },
  })
  const env = (name, key) => ({
    name,
    valueFrom: { secretKeyRef: { name: 'fixture', key } },
  })
  const literal = (name, value) => ({ name, value })
  const identity = ['UID', 'NAME', 'NAMESPACE'].map((key) => ({
    name: `BABEL_RUNTIME_POD_${key}`,
    valueFrom: { fieldRef: { fieldPath: `metadata.${key.toLowerCase()}` } },
  }))
  const restricted = {
    runAsUser: 1000,
    runAsNonRoot: true,
    readOnlyRootFilesystem: true,
    allowPrivilegeEscalation: false,
    capabilities: { drop: ['ALL'] },
  }
  const deployment = (name, container, node = context, managed = false) => ({
    apiVersion: 'apps/v1',
    kind: 'Deployment',
    metadata: metadata(name),
    spec: {
      replicas: 1,
      selector: { matchLabels: { app: name } },
      template: {
        metadata: {
          labels: {
            ...metadata(name).labels,
            ...(managed ? { [supervised]: 'true' } : {}),
          },
          ...(managed ? { finalizers: [finalizer] } : {}),
        },
        spec: {
          nodeName: node,
          serviceAccountName: name === 'recovery' ? 'recovery' : 'default',
          automountServiceAccountToken: name === 'recovery',
          terminationGracePeriodSeconds: 15,
          containers: [container],
          volumes: [
            { name: 'temp', emptyDir: { medium: 'Memory', sizeLimit: '256Mi' } },
          ],
        },
      },
    },
  })
  const service = (name, port) => ({
    apiVersion: 'v1',
    kind: 'Service',
    metadata: metadata(name),
    spec: {
      selector: { app: name },
      ...(name === 'web' ? { type: 'NodePort' } : {}),
      ports: [
        { port, targetPort: port, ...(name === 'web' ? { nodePort: 32443 } : {}) },
      ],
    },
  })
  const apply = (items) =>
    kube(
      ['apply', '-f', '-'],
      JSON.stringify({ apiVersion: 'v1', kind: 'List', items }),
    )
  const rollout = (name) =>
    kube(['rollout', 'status', `deployment/${name}`, '--timeout=90s'])
  function pod(name) {
    return JSON.parse(
      kube(['get', 'pods', '-l', `app=${name}`, '-o', 'json']),
    ).items.find((item) => !item.metadata.deletionTimestamp)
  }
  async function forward(name, resource, target) {
    const previous = forwards.get(name)
    if (previous && previous.exitCode === null && previous.signalCode === null) {
      const ended = once(previous, 'exit')
      previous.kill('SIGTERM')
      await ended
    }
    const child = spawn(
      'kubectl',
      [
        '--context',
        context,
        '-n',
        namespace,
        'port-forward',
        resource,
        `${ports[name]}:${target}`,
        '--address=127.0.0.1',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    forwards.set(name, child)
    child.stderr.resume()
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Fixture forwarding timeout')),
        15_000,
      )
      child.stdout.on('data', (data) => {
        if (data.toString().includes('Forwarding from')) {
          clearTimeout(timer)
          resolve()
        }
      })
      child.once('exit', () => {
        clearTimeout(timer)
        reject(new Error('Fixture forwarding exited'))
      })
    })
  }
  async function close() {
    command('docker', ['exec', `${context}-m02`, 'systemctl', 'start', 'kubelet'])
    for (const child of forwards.values()) {
      if (child.exitCode === null && child.signalCode === null) {
        const ended = once(child, 'exit')
        child.kill('SIGTERM')
        await ended
      }
    }
    // The isolated DB is discarded too. These are explicitly owned test Pods;
    // resume kubelet and stop all test deployments before removing finalizers.
    kube(['scale', 'deployment', '--all', '--replicas=0'])
    const pods = JSON.parse(kube(['get', 'pods', '-o', 'json'])).items
    for (const item of pods) {
      assert.equal(item.metadata.labels['babel-recovery-test'], runId)
      if (item.metadata.finalizers?.includes(finalizer)) {
        kube([
          'patch',
          'pod',
          item.metadata.name,
          '--type=merge',
          '-p',
          JSON.stringify({
            metadata: {
              finalizers: item.metadata.finalizers.filter(
                (value) => value !== finalizer,
              ),
            },
          }),
        ])
      }
    }
    kube(['delete', 'namespace', namespace, '--wait=true', '--timeout=90s'])
  }
  try {
    apply([
      {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: { name: namespace, labels: { 'babel-recovery-test': runId } },
      },
      {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: metadata('fixture'),
        stringData: {
          'database-url': `postgresql://babel_app:${password}@database:5432/babel_fixture`,
          'admin-password': randomBytes(24).toString('hex'),
          'control-secret': randomBytes(32).toString('base64url'),
          'encryption-key': randomBytes(32).toString('base64'),
          'auth-secret': randomBytes(32).toString('base64'),
        },
      },
      service('database', 5432),
      service('web', 3000),
      service('stable', 3000),
      service('voice', 3100),
      deployment('database', {
        name: 'database',
        image: 'postgres:13-alpine',
        env: [env('POSTGRES_PASSWORD', 'admin-password')],
        volumeMounts: [{ name: 'temp', mountPath: '/var/lib/postgresql/data' }],
        readinessProbe: {
          exec: { command: ['pg_isready', '-h', '127.0.0.1', '-U', 'postgres'] },
          periodSeconds: 2,
        },
      }),
      { apiVersion: 'v1', kind: 'ServiceAccount', metadata: metadata('recovery') },
      {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'Role',
        metadata: metadata('recovery'),
        rules: [
          {
            apiGroups: [''],
            resources: ['pods'],
            verbs: ['get', 'list', 'patch', 'delete'],
          },
        ],
      },
      {
        apiVersion: 'rbac.authorization.k8s.io/v1',
        kind: 'RoleBinding',
        metadata: metadata('recovery'),
        subjects: [{ kind: 'ServiceAccount', name: 'recovery', namespace }],
        roleRef: {
          apiGroup: 'rbac.authorization.k8s.io',
          kind: 'Role',
          name: 'recovery',
        },
      },
    ])
    rollout('database')
    // Readiness precedes kube-proxy's Service update. Verify the same DNS/Service
    // route the migration will use before submitting its non-retrying Job.
    for (let attempt = 0; ; attempt += 1) {
      try {
        kube([
          'exec',
          pod('database').metadata.name,
          '--',
          'pg_isready',
          '-h',
          'database',
          '-U',
          'postgres',
        ])
        break
      } catch {
        if (attempt >= 30) {
          throw new Error('Local database Service did not become reachable')
        }
        await delay(500)
      }
    }
    kube(
      [
        'exec',
        '-i',
        pod('database').metadata.name,
        '--',
        'psql',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'postgres',
      ],
      `create role babel_app login password '${password}' nosuperuser nocreatedb nocreaterole;\ncreate database babel_fixture owner babel_app;\n`,
    )
    apply([
      {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: metadata('migrate'),
        spec: {
          backoffLimit: 0,
          template: {
            metadata: { labels: metadata('migrate').labels },
            spec: {
              nodeName: context,
              restartPolicy: 'Never',
              automountServiceAccountToken: false,
              containers: [
                {
                  name: 'migrate',
                  image: webImage,
                  imagePullPolicy: 'Never',
                  command: ['node', 'database/migrate.mjs'],
                  env: [env('DATABASE_URL', 'database-url')],
                },
              ],
            },
          },
        },
      },
    ])
    kube(['wait', '--for=condition=complete', 'job/migrate', '--timeout=90s'])
    const container = (name, image, environment, port) => ({
      name,
      image,
      imagePullPolicy: 'Never',
      securityContext: restricted,
      env: environment,
      resources: {
        requests: { cpu: '50m', memory: '64Mi' },
        limits: { memory: '768Mi' },
      },
      ports: [{ containerPort: port }],
      volumeMounts: [{ name: 'temp', mountPath: '/tmp' }],
      readinessProbe: { tcpSocket: { port }, periodSeconds: 2 },
    })
    const web = (name, node) =>
      deployment(
        name,
        {
          ...container(
            name,
            webImage,
            [
              env('NUXT_DATABASE_URL', 'database-url'),
              env('NUXT_BETTER_AUTH_SECRET', 'auth-secret'),
              env('NUXT_PROVIDER_ENCRYPTION_KEY', 'encryption-key'),
              env('NUXT_MEDIA_CONTROL_SECRET', 'control-secret'),
              literal('NUXT_MEDIA_CONTROL_URL', 'http://voice:3100'),
              literal('NUXT_DATABASE_POOL_MAX', '2'),
              literal('NUXT_SITE_URL', origin),
              literal('NUXT_ACCESS_TEAM_DOMAIN', 'local-test.cloudflareaccess.com'),
              literal('NUXT_ACCESS_AUDIENCE', 'local-test'),
              ...identity,
            ],
            3000,
          ),
          readinessProbe: {
            httpGet: { path: '/api/health/ready', port: 3000 },
            periodSeconds: 2,
          },
        },
        node,
        true,
      )
    apply([
      deployment(
        'voice',
        container(
          'voice',
          voiceImage,
          [
            env('DATABASE_URL', 'database-url'),
            env('MEDIA_CONTROL_SECRET', 'control-secret'),
            env('PROVIDER_ENCRYPTION_KEY', 'encryption-key'),
            literal('DATABASE_POOL_MAX', '2'),
            ...identity,
          ],
          3100,
        ),
        `${context}-m02`,
        true,
      ),
      web('web', `${context}-m02`),
      web('stable', context),
      deployment('recovery', {
        ...container(
          'recovery',
          webImage,
          [env('DATABASE_URL', 'database-url'), identity[2]],
          3200,
        ),
        command: ['node', 'recovery/index.mjs'],
        readinessProbe: {
          httpGet: { path: '/health/ready', port: 3200 },
          periodSeconds: 2,
        },
      }),
    ])
    for (const name of ['voice', 'web', 'stable', 'recovery']) {
      rollout(name)
    }
    await forward('database', 'service/database', 5432)
    await forward('stable', 'service/stable', 3000)
    return {
      kube,
      pod,
      rollout,
      forward,
      close,
      context,
      namespace,
      origin,
      ports,
      runId,
      databaseUrl: `postgresql://babel_app:${password}@127.0.0.1:${ports.database}/babel_fixture`,
    }
  } catch (error) {
    await close()
    throw error
  }
}
