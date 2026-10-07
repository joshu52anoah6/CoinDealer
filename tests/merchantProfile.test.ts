import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isMerchantPayProfileEmpty,
  isValidMerchantEmail,
  normalizeMerchantPayProfile,
} from '../src/api/merchantProfile.ts'

test('treats null and whitespace-only payer profiles as first-time profiles', () => {
  assert.equal(isMerchantPayProfileEmpty(null), true)
  assert.equal(isMerchantPayProfileEmpty({ name: ' ', email: '', phone: '\t' }), true)
})

test('skips first-time setup when any saved payer field is present', () => {
  assert.equal(isMerchantPayProfileEmpty({ name: 'Ada' }), false)
  assert.equal(isMerchantPayProfileEmpty({ email: 'ada@example.com' }), false)
  assert.equal(isMerchantPayProfileEmpty({ phone: '+65 1234 5678' }), false)
})

test('normalizes payer fields before display and save', () => {
  assert.deepEqual(normalizeMerchantPayProfile({ name: ' Ada ', email: ' a@example.com ', phone: ' +65 1234 ' }), {
    name: 'Ada',
    email: 'a@example.com',
    phone: '+65 1234',
  })
})

test('validates email syntax before saving the profile', () => {
  assert.equal(isValidMerchantEmail(' ada@example.com '), true)
  assert.equal(isValidMerchantEmail('ada@'), false)
  assert.equal(isValidMerchantEmail('ada example.com'), false)
})
