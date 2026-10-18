import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import { once } from 'node:events'
import { Message, parseMessage, methods, classes, makeIntegrityKey } from 'werift'

// Read the actual TURN authentication response on the wire. Werift deliberately
// drops unsigned errors once an integrity key is set, so its timeout cannot prove
// that Coturn rejected expired credentials. A fresh-credential positive control
// exercises the identical request construction.
export async function turnAllocation(url, credentials) {
  const relay = new URL(url.replace('turn:', 'http://'))
  const socket = dgram.createSocket('udp4')
  socket.bind(0, '127.0.0.1')
  await once(socket, 'listening')
  async function exchange(request) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('TURN response timed out')), 2000)
      function finish(error, response) {
        clearTimeout(timer)
        socket.off('message', receive)
        if (error) {
          reject(error)
        } else {
          resolve(response)
        }
      }
      function receive(data, remote) {
        if (remote.address !== relay.hostname || remote.port !== Number(relay.port)) {
          return
        }
        const message = parseMessage(data)
        if (message?.transactionId.equals(request.transactionId)) {
          finish(null, message)
        }
      }
      socket.on('message', receive)
      socket.send(request.bytes, Number(relay.port), relay.hostname, (error) => {
        if (error) {
          finish(error)
        }
      })
    })
  }
  const allocate = () =>
    new Message(methods.ALLOCATE, classes.REQUEST).setAttribute(
      'REQUESTED-TRANSPORT',
      17 << 24,
    )
  try {
    const challenge = await exchange(allocate())
    assert.equal(challenge.getAttributeValue('ERROR-CODE')?.[0], 401)
    const realm = challenge.getAttributeValue('REALM')
    const nonce = challenge.getAttributeValue('NONCE')
    assert.ok(realm && nonce)
    const response = await exchange(
      allocate()
        .setAttribute('USERNAME', credentials.username)
        .setAttribute('REALM', realm)
        .setAttribute('NONCE', nonce)
        .addMessageIntegrity(
          makeIntegrityKey(credentials.username, realm, credentials.credential),
        ),
    )
    if (response.messageClass === classes.ERROR) {
      return response.getAttributeValue('ERROR-CODE')?.[0]
    }
    assert.equal(response.messageClass, classes.RESPONSE)
    assert.ok(response.getAttributeValue('XOR-RELAYED-ADDRESS'))
    return 200
  } finally {
    await new Promise((resolve) => socket.close(resolve))
  }
}
