import type { RuntimePodIdentity } from '@babel/database/runtime-pods'

export function runtimePodIdentity(): RuntimePodIdentity | undefined {
  const uid = process.env.BABEL_RUNTIME_POD_UID
  const name = process.env.BABEL_RUNTIME_POD_NAME
  const namespace = process.env.BABEL_RUNTIME_POD_NAMESPACE
  if (uid === undefined && name === undefined && namespace === undefined) {
    return undefined
  }
  if (
    !uid ||
    !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/.test(uid) ||
    !name ||
    name.length > 253 ||
    !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(name) ||
    !namespace ||
    namespace.length > 63 ||
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(namespace)
  ) {
    throw new Error('Runtime Pod identity is invalid')
  }
  return { uid, name, namespace }
}
