/**
 * Dependency-free image header parsing (Milestone: product media
 * intelligence, Phase 7).
 *
 * Deterministic byte-format parsing — reading the fixed-position fields
 * every JPEG/PNG/WEBP file's own format specification defines for its
 * dimensions — never image analysis or computer vision. Only needs the
 * first few hundred bytes of a file, which is exactly what
 * `imageFetch.ts` fetches. AVIF's container signature is detected (so
 * the format is still reported honestly) but its dimension box lives
 * inside a more deeply nested ISOBMFF structure this parser does not
 * walk — width/height are `null` for AVIF, an honest gap, not a guess.
 */

export interface ParsedImageHeader {
  format: 'jpeg' | 'png' | 'webp' | 'avif'
  width: number | null
  height: number | null
}

function readUInt16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) | bytes[offset + 1]
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return Array.from(bytes.slice(offset, offset + length)).map((b) => String.fromCharCode(b)).join('')
}

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
const NO_LENGTH_MARKERS = new Set([0xd8, 0xd9, 0x01])

function parseJpeg(bytes: Uint8Array): ParsedImageHeader {
  let offset = 2 // Skip the SOI marker (FFD8).
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    if (marker === 0xff) {
      offset += 1 // Fill byte.
      continue
    }
    if (marker >= 0xd0 && marker <= 0xd7) {
      offset += 2
      continue
    }
    if (NO_LENGTH_MARKERS.has(marker)) {
      offset += 2
      continue
    }
    if (SOF_MARKERS.has(marker)) {
      const height = readUInt16BE(bytes, offset + 5)
      const width = readUInt16BE(bytes, offset + 7)
      return { format: 'jpeg', width, height }
    }
    const segmentLength = readUInt16BE(bytes, offset + 2)
    offset += 2 + segmentLength
  }
  return { format: 'jpeg', width: null, height: null }
}

function parsePng(bytes: Uint8Array): ParsedImageHeader {
  // IHDR is always the very first chunk, at a fixed offset.
  if (bytes.length < 24 || asciiAt(bytes, 12, 4) !== 'IHDR') {
    return { format: 'png', width: null, height: null }
  }
  return { format: 'png', width: readUInt32BE(bytes, 16), height: readUInt32BE(bytes, 20) }
}

function parseWebp(bytes: Uint8Array): ParsedImageHeader {
  if (bytes.length < 30) return { format: 'webp', width: null, height: null }
  const fourCC = asciiAt(bytes, 12, 4)

  if (fourCC === 'VP8 ') {
    // 3-byte frame tag, then a 3-byte start code (0x9d 0x01 0x2a), then
    // width/height as 14-bit little-endian fields.
    const width = readUInt16LE(bytes, 26) & 0x3fff
    const height = readUInt16LE(bytes, 28) & 0x3fff
    return { format: 'webp', width, height }
  }

  if (fourCC === 'VP8L') {
    const b0 = bytes[21]
    const b1 = bytes[22]
    const b2 = bytes[23]
    const b3 = bytes[24]
    const width = 1 + (((b1 & 0x3f) << 8) | b0)
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6))
    return { format: 'webp', width, height }
  }

  if (fourCC === 'VP8X') {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16))
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
    return { format: 'webp', width, height }
  }

  return { format: 'webp', width: null, height: null }
}

export function parseImageHeader(bytes: Uint8Array): ParsedImageHeader | null {
  if (bytes.length < 12) return null

  if (bytes[0] === 0xff && bytes[1] === 0xd8) return parseJpeg(bytes)

  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return parsePng(bytes)

  if (asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 4) === 'WEBP') return parseWebp(bytes)

  // ISOBMFF ftyp box: 4-byte size, 'ftyp', then a 4-byte major brand.
  if (asciiAt(bytes, 4, 4) === 'ftyp') {
    const brand = asciiAt(bytes, 8, 4)
    if (brand === 'avif' || brand === 'avis') return { format: 'avif', width: null, height: null }
  }

  return null
}

