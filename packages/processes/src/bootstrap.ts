export async function receiveRuntimeOwner(): Promise<string> {
  if (!process.connected) {
    throw new Error('Runtime requires its supervisor')
  }
  return new Promise((resolve, reject) => {
    function clear() {
      process.off('message', message)
      process.off('disconnect', disconnected)
    }
    function disconnected() {
      clear()
      reject(new Error('Runtime supervisor disconnected'))
    }
    function message(value: unknown) {
      clear()
      if (
        typeof value !== 'object' ||
        value === null ||
        !('type' in value) ||
        value.type !== 'start' ||
        !('ownerId' in value) ||
        typeof value.ownerId !== 'string' ||
        !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/.test(value.ownerId)
      ) {
        reject(new Error('Runtime bootstrap is invalid'))
      } else {
        resolve(value.ownerId)
      }
    }
    process.once('message', message)
    process.once('disconnect', disconnected)
  })
}
