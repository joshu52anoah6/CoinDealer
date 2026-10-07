import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError, decodeResponsePayload } from '../src/api/http.ts'

test('detects plaintext code 153 before decrypting with the outdated key', async () => {
  let decryptCalls = 0
  let outdatedCalls = 0
  let acceptedCalls = 0
  const response = { code: 153, message: 'Client key is outdated.', data: null }

  const payload = await decodeResponsePayload(JSON.stringify(response), {
    encrypted: true,
    status: 200,
    decrypt: async () => {
      decryptCalls += 1
      throw new Error('The outdated key cannot decrypt this response.')
    },
    onClientVersionOutdated: () => { outdatedCalls += 1 },
    onProtectedResponseAccepted: () => { acceptedCalls += 1 },
  })

  assert.deepEqual(payload, response)
  assert.equal(decryptCalls, 0)
  assert.equal(outdatedCalls, 1)
  assert.equal(acceptedCalls, 0)
})

test('marks only a successfully decrypted response as protected and healthy', async () => {
  let acceptedCalls = 0
  const response = { code: 0, data: { gold: 100 } }

  const payload = await decodeResponsePayload('encrypted-response', {
    encrypted: true,
    status: 200,
    decrypt: async () => response,
    onProtectedResponseAccepted: () => { acceptedCalls += 1 },
  })

  assert.deepEqual(payload, response)
  assert.equal(acceptedCalls, 1)
})

test('keeps non-version decryption failures as authentication errors', async () => {
  await assert.rejects(
    decodeResponsePayload('not-an-encrypted-response', {
      encrypted: true,
      status: 502,
      decrypt: async () => { throw new Error('Authentication failed.') },
    }),
    (error: unknown) => error instanceof ApiError
      && error.status === 502
      && error.message === 'The encrypted merchant API response could not be authenticated.',
  )
})
