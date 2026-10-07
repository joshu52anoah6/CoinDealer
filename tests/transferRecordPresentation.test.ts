import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatTransferRecordAmount,
  formatTransferRecordTime,
  transferRecordRecipient,
  transferRecordRecipientId,
} from '../src/utils/transferRecordPresentation.ts'

test('formats every merchant transfer as an outgoing amount', () => {
  assert.equal(formatTransferRecordAmount(1250.5), '-1,250.5')
  assert.equal(formatTransferRecordAmount(-12.5), '-12.5')
  assert.equal(formatTransferRecordAmount(0), '0')
  assert.equal(formatTransferRecordAmount(undefined), '—')
})

test('uses the server-formatted transfer time when it is available', () => {
  assert.equal(
    formatTransferRecordTime({ createdAt: 1, createdAtText: '2026-09-17 18:30:45' }),
    '2026-09-17 18:30:45',
  )
  assert.equal(formatTransferRecordTime({}), 'Time unavailable')
})

test('presents the target user fields from the transfer record contract', () => {
  const record = { targetNickname: 'Alex', targetUserId: '12345' }
  assert.equal(transferRecordRecipient(record), 'Alex')
  assert.equal(transferRecordRecipientId(record), 'User ID 12345')
  assert.equal(transferRecordRecipient({ targetUserId: '12345' }), 'Recipient')
  assert.equal(transferRecordRecipientId({}), 'Recipient ID unavailable')
})
