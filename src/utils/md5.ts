/** Returns the lowercase MD5 hex digest used by the coin-merchant login API. */
export function md5Hex(value: string) {
  const input = new TextEncoder().encode(value)
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64
  const bytes = new Uint8Array(paddedLength)
  bytes.set(input)
  bytes[input.length] = 0x80

  // MD5 appends the original length as an unsigned 64-bit little-endian bit
  // count. Merchant passwords are short, but writing both words keeps the
  // implementation correct for any UTF-8 input.
  const bitLength = input.length * 8
  const lowLength = bitLength >>> 0
  const highLength = Math.floor(bitLength / 0x100000000) >>> 0
  const lengthOffset = bytes.length - 8
  bytes[lengthOffset] = lowLength & 0xff
  bytes[lengthOffset + 1] = (lowLength >>> 8) & 0xff
  bytes[lengthOffset + 2] = (lowLength >>> 16) & 0xff
  bytes[lengthOffset + 3] = (lowLength >>> 24) & 0xff
  bytes[lengthOffset + 4] = highLength & 0xff
  bytes[lengthOffset + 5] = (highLength >>> 8) & 0xff
  bytes[lengthOffset + 6] = (highLength >>> 16) & 0xff
  bytes[lengthOffset + 7] = (highLength >>> 24) & 0xff

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ]
  const constants = Array.from({ length: 64 }, (_, index) =>
    Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0,
  )

  let a0 = 0x67452301
  let b0 = 0xefcdab89
  let c0 = 0x98badcfe
  let d0 = 0x10325476

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Uint32Array(16)
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4
      words[index] = (
        bytes[position]
        | (bytes[position + 1] << 8)
        | (bytes[position + 2] << 16)
        | (bytes[position + 3] << 24)
      ) >>> 0
    }

    let a = a0
    let b = b0
    let c = c0
    let d = d0

    for (let index = 0; index < 64; index += 1) {
      let f: number
      let wordIndex: number
      if (index < 16) {
        f = (b & c) | (~b & d)
        wordIndex = index
      } else if (index < 32) {
        f = (d & b) | (~d & c)
        wordIndex = (5 * index + 1) % 16
      } else if (index < 48) {
        f = b ^ c ^ d
        wordIndex = (3 * index + 5) % 16
      } else {
        f = c ^ (b | ~d)
        wordIndex = (7 * index) % 16
      }

      const sum = (a + f + constants[index] + words[wordIndex]) >>> 0
      const rotated = (sum << shifts[index]) | (sum >>> (32 - shifts[index]))
      const next = (b + rotated) >>> 0
      a = d
      d = c
      c = b
      b = next
    }

    a0 = (a0 + a) >>> 0
    b0 = (b0 + b) >>> 0
    c0 = (c0 + c) >>> 0
    d0 = (d0 + d) >>> 0
  }

  return [a0, b0, c0, d0]
    .map((word) => [
      word & 0xff,
      (word >>> 8) & 0xff,
      (word >>> 16) & 0xff,
      (word >>> 24) & 0xff,
    ].map((byte) => byte.toString(16).padStart(2, '0')).join(''))
    .join('')
}
