import { describe, expect, it } from 'vitest'
import { parseImageHeader } from '@/lib/products/media/imageHeaderParser'

describe('Dependency-free image header parser', () => {
  it('parses a real PNG IHDR chunk for width/height', () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, // IHDR chunk length = 13
      0x49, 0x48, 0x44, 0x52, // "IHDR"
      0x00, 0x00, 0x04, 0x00, // width = 1024
      0x00, 0x00, 0x03, 0x00, // height = 768
      0x08, 0x02, 0x00, 0x00, 0x00, // bit depth / colour type / compression / filter / interlace
      0x00, 0x00, 0x00, 0x00, // CRC (not validated by this parser)
    ])
    const result = parseImageHeader(bytes)
    expect(result).toEqual({ format: 'png', width: 1024, height: 768 })
  })

  it('parses a real JPEG SOF0 marker for width/height', () => {
    const bytes = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xc0, // SOF0
      0x00, 0x11, // segment length = 17
      0x08, // precision
      0x02, 0x58, // height = 600
      0x03, 0x20, // width = 800
      0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, // component data (unread)
    ])
    const result = parseImageHeader(bytes)
    expect(result).toEqual({ format: 'jpeg', width: 800, height: 600 })
  })

  it('parses a real WEBP VP8X extended header for width/height', () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // "RIFF"
      0x00, 0x00, 0x00, 0x20, // file size (arbitrary, unread)
      0x57, 0x45, 0x42, 0x50, // "WEBP"
      0x56, 0x50, 0x38, 0x58, // "VP8X"
      0x0a, 0x00, 0x00, 0x00, // chunk size = 10
      0x00, // flags
      0x00, 0x00, 0x00, // reserved
      0x8f, 0x01, 0x00, // width - 1 = 399 -> width = 400
      0x2b, 0x01, 0x00, // height - 1 = 299 -> height = 300
    ])
    const result = parseImageHeader(bytes)
    expect(result).toEqual({ format: 'webp', width: 400, height: 300 })
  })

  it('detects an AVIF container by its ftyp brand without claiming dimensions it cannot determine', () => {
    const bytes = new Uint8Array([
      0x00, 0x00, 0x00, 0x1c, // box size
      0x66, 0x74, 0x79, 0x70, // "ftyp"
      0x61, 0x76, 0x69, 0x66, // "avif" major brand
      0x00, 0x00, 0x00, 0x00,
    ])
    const result = parseImageHeader(bytes)
    expect(result).toEqual({ format: 'avif', width: null, height: null })
  })

  it('returns null for an unrecognised or too-short byte sequence, never a guessed format', () => {
    expect(parseImageHeader(new Uint8Array([0, 1, 2]))).toBeNull()
    expect(parseImageHeader(new Uint8Array(Array(20).fill(0x00)))).toBeNull()
  })
})
