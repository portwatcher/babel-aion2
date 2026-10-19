import { z } from 'zod'
import type { RuntimePodExitEvidence } from '@babel/database/schema'

export const ownershipFinalizer = 'babel.juryquinn.com/runtime-ownership'
export const ownershipLabel = 'babel.juryquinn.com/supervised'

const container = z.object({ name: z.string().min(1) })
const terminated = z.object({
  containerID: z.string().optional(),
  exitCode: z.number().int(),
  reason: z.string().optional(),
  // metav1.Time is serialized as null when kubelet has no runtime timestamp.
  startedAt: z.string().nullish(),
  finishedAt: z.string().nullish(),
})
const status = z.object({
  name: z.string(),
  containerID: z.string().optional(),
  state: z.object({
    terminated: terminated.optional(),
    running: z.unknown().optional(),
    waiting: z.unknown().optional(),
  }),
})

// Keep only identity and termination data; never retain Pod environment or logs.
export const podSchema = z.object({
  metadata: z.object({
    uid: z.uuid(),
    name: z.string().min(1),
    namespace: z.string().min(1),
    resourceVersion: z.string().min(1),
    labels: z.record(z.string(), z.string()).optional(),
    finalizers: z.array(z.string()).optional(),
    deletionTimestamp: z.string().nullable().optional(),
  }),
  spec: z.object({
    containers: z.array(container).min(1),
    initContainers: z.array(container).optional(),
    ephemeralContainers: z.array(container).optional(),
  }),
  status: z
    .object({
      phase: z.string().optional(),
      reason: z.string().optional(),
      containerStatuses: z.array(status).optional(),
      initContainerStatuses: z.array(status).optional(),
      ephemeralContainerStatuses: z.array(status).optional(),
    })
    .optional(),
})

export type Pod = z.infer<typeof podSchema>

export function managedPod(pod: Pod, namespace: string) {
  return (
    pod.metadata.namespace === namespace &&
    pod.metadata.labels?.[ownershipLabel] === 'true' &&
    pod.metadata.finalizers?.includes(ownershipFinalizer) === true
  )
}

export function terminationEvidence(
  pod: Pod,
): Extract<RuntimePodExitEvidence, { kind: 'kubelet-terminated' }> | undefined {
  if (
    !pod.metadata.deletionTimestamp ||
    !['Succeeded', 'Failed'].includes(pod.status?.phase ?? '') ||
    pod.status?.reason === 'NodeLost'
  ) {
    return
  }
  const containers = []
  const groups = [
    [pod.spec.containers, pod.status?.containerStatuses ?? []],
    [pod.spec.initContainers ?? [], pod.status?.initContainerStatuses ?? []],
    [pod.spec.ephemeralContainers ?? [], pod.status?.ephemeralContainerStatuses ?? []],
  ] as const
  for (const [expected, observed] of groups) {
    if (
      expected.length !== observed.length ||
      new Set(observed.map((item) => item.name)).size !== expected.length
    ) {
      return
    }
    for (const { name } of expected) {
      const current = observed.find((item) => item.name === name)
      const exit = current?.state.terminated
      const started = Date.parse(exit?.startedAt ?? '')
      const finished = Date.parse(exit?.finishedAt ?? '')
      if (
        !exit ||
        current?.state.running !== undefined ||
        current?.state.waiting !== undefined ||
        !exit.containerID ||
        !/^(containerd|cri-o|docker):\/\/[a-f0-9]{64}$/.test(exit.containerID) ||
        current?.containerID !== exit.containerID ||
        !exit.reason ||
        !['Completed', 'Error', 'OOMKilled'].includes(exit.reason) ||
        !Number.isFinite(started) ||
        !Number.isFinite(finished) ||
        started <= 0 ||
        finished < started ||
        !exit.finishedAt
      ) {
        // Kubernetes can synthesize exitCode 137 / ContainerStatusUnknown.
        // Phase, a missing Pod and lastState are never termination receipts.
        return
      }
      containers.push({
        name,
        containerId: exit.containerID,
        exitCode: exit.exitCode,
        reason: exit.reason,
        finishedAt: exit.finishedAt,
      })
    }
  }
  return {
    kind: 'kubelet-terminated',
    resourceVersion: pod.metadata.resourceVersion,
    containers,
  }
}
