import type { Database } from '@babel/database'
import {
  confirmRuntimePodExit,
  requestedRuntimePodRetirements,
  sealRuntimePod,
} from '@babel/database/runtime-pods'
import { Kubernetes, KubernetesError } from './kubernetes.ts'
import { managedPod, terminationEvidence } from './pods.ts'

export async function reconcile(database: Database, kubernetes: Kubernetes) {
  const requests = await requestedRuntimePodRetirements(database, kubernetes.namespace)
  const pods = await kubernetes.pods()
  for (const pod of pods) {
    if (!managedPod(pod, kubernetes.namespace)) {
      continue
    }
    const identity = {
      uid: pod.metadata.uid,
      name: pod.metadata.name,
      namespace: pod.metadata.namespace,
    }
    try {
      if (!pod.metadata.deletionTimestamp) {
        if (
          requests.some(
            (item) => item.uid === identity.uid && item.name === identity.name,
          )
        ) {
          await kubernetes.retire(pod)
        }
        continue
      }
      if (!(await sealRuntimePod(database, identity))) {
        const evidence = terminationEvidence(pod)
        if (!evidence) {
          continue
        }
        await confirmRuntimePodExit(database, identity, evidence)
      }
      // Durable fencing and scoped receipts must commit before the object disappears.
      await kubernetes.finalize(pod)
    } catch (error) {
      if (error instanceof KubernetesError && [404, 409, 422].includes(error.status)) {
        // Refresh next poll; a missing/changed object never supplies exit proof.
        continue
      }
      throw error
    }
  }
}
