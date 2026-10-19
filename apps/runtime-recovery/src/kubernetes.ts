import { readFile } from 'node:fs/promises'
import { request } from 'node:https'
import { z } from 'zod'
import { ownershipFinalizer, ownershipLabel, podSchema, type Pod } from './pods.ts'

const serviceAccount = '/var/run/secrets/kubernetes.io/serviceaccount'

export class KubernetesError extends Error {
  constructor(readonly status: number) {
    super('Kubernetes request failed')
  }
}

export class Kubernetes {
  private readonly origin: URL
  private readonly path: string

  constructor(readonly namespace: string) {
    const host = process.env.KUBERNETES_SERVICE_HOST
    const port = process.env.KUBERNETES_SERVICE_PORT_HTTPS
    if (!host || !port || !/^\d+$/.test(port) || !/^[a-z0-9.-]+$/.test(namespace)) {
      throw new Error('Kubernetes service configuration is missing or invalid')
    }
    this.origin = new URL(`https://${host.includes(':') ? `[${host}]` : host}:${port}`)
    this.path = `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`
  }

  private async call(method: string, path: string, body?: unknown, patch = false) {
    // Projected service-account tokens rotate. Read the current token for every call.
    const [token, ca] = await Promise.all([
      readFile(`${serviceAccount}/token`, 'utf8'),
      readFile(`${serviceAccount}/ca.crt`),
    ])
    const payload = body === undefined ? undefined : JSON.stringify(body)
    return new Promise<unknown>((resolve, reject) => {
      const req = request(
        new URL(path, this.origin),
        {
          method,
          ca,
          signal: AbortSignal.timeout(5_000),
          headers: {
            authorization: `Bearer ${token.trim()}`,
            accept: 'application/json',
            ...(payload === undefined
              ? {}
              : {
                  'content-type': patch
                    ? 'application/json-patch+json'
                    : 'application/json',
                  'content-length': Buffer.byteLength(payload),
                }),
          },
        },
        (response) => {
          const chunks: Buffer[] = []
          let size = 0
          response.on('error', reject)
          response.on('data', (chunk: Buffer) => {
            size += chunk.length
            if (size > 2 * 1024 * 1024) {
              response.destroy(new Error('Kubernetes response exceeds limit'))
              return
            }
            chunks.push(chunk)
          })
          response.on('end', () => {
            if (!response.statusCode || response.statusCode >= 300) {
              reject(new KubernetesError(response.statusCode ?? 0))
              return
            }
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
            } catch {
              reject(new Error('Invalid Kubernetes response'))
            }
          })
        },
      )
      req.on('error', reject)
      req.end(payload)
    })
  }

  async pods() {
    const selector = encodeURIComponent(`${ownershipLabel}=true`)
    const result = await this.call('GET', `${this.path}?labelSelector=${selector}`)
    return z.object({ items: z.array(podSchema) }).parse(result).items
  }

  async retire(pod: Pod) {
    await this.call('DELETE', `${this.path}/${encodeURIComponent(pod.metadata.name)}`, {
      apiVersion: 'v1',
      kind: 'DeleteOptions',
      preconditions: {
        uid: pod.metadata.uid,
        resourceVersion: pod.metadata.resourceVersion,
      },
      // Keep the Pod's normal grace period. A forced delete is not exit evidence.
    })
  }

  async finalize(pod: Pod) {
    await this.call(
      'PATCH',
      `${this.path}/${encodeURIComponent(pod.metadata.name)}`,
      [
        { op: 'test', path: '/metadata/uid', value: pod.metadata.uid },
        {
          op: 'test',
          path: '/metadata/resourceVersion',
          value: pod.metadata.resourceVersion,
        },
        {
          op: 'replace',
          path: '/metadata/finalizers',
          value: pod.metadata.finalizers?.filter((item) => item !== ownershipFinalizer),
        },
      ],
      true,
    )
  }
}
