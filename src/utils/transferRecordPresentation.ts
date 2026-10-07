import type { MerchantTransferRecordItem } from '../types/api'

const amountFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
})

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
  minute: '2-digit',
  month: 'short',
  second: '2-digit',
  year: 'numeric',
})

function numeric(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function formatTransferRecordAmount(value: unknown) {
  const amount = numeric(value)
  if (amount === null) return '—'
  if (amount === 0) return '0'
  return `-${amountFormatter.format(Math.abs(amount))}`
}

export function formatTransferRecordTime(item: MerchantTransferRecordItem) {
  const serverText = text(item.createdAtText)
  if (serverText) return serverText

  const timestamp = numeric(item.createdAt)
  if (timestamp === null) return 'Time unavailable'
  const date = new Date(timestamp * 1000)
  return Number.isNaN(date.getTime()) ? 'Time unavailable' : timeFormatter.format(date)
}

export function transferRecordRecipient(item: MerchantTransferRecordItem) {
  return text(item.targetNickname) || 'Recipient'
}

export function transferRecordRecipientId(item: MerchantTransferRecordItem) {
  const userId = text(item.targetUserId)
  return userId ? `User ID ${userId}` : 'Recipient ID unavailable'
}
