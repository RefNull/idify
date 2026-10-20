import { describe, expect, it } from 'vitest'
import { withPngDensity } from './png'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

/** Reference CRC-32 (IEEE), independent of the implementation under test. */
function referenceCrc(bytes: Uint8Array) {
  let crc = ~0
  for (const byte of bytes) {
    crc ^= byte
    for (let k = 0; k < 8; k += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return ~crc >>> 0
}

function chunk(type: string, data: number[] = []) {
  const bytes = new Uint8Array(12 + data.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, data.length)
  for (let i = 0; i < 4; i += 1) {
    bytes[4 + i] = type.charCodeAt(i)
  }
  bytes.set(data, 8)
  view.setUint32(
    8 + data.length,
    referenceCrc(bytes.subarray(4, 8 + data.length))
  )
  return bytes
}

function png(...chunks: Uint8Array[]) {
  return new Blob([new Uint8Array(SIGNATURE), ...chunks] as BlobPart[], {
    type: 'image/png',
  })
}

const IHDR = chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])
const IDAT = chunk('IDAT', [1, 2, 3])
const IEND = chunk('IEND')

interface Chunk {
  type: string
  data: Uint8Array
  crc: number
  crcInput: Uint8Array
}

async function readChunks(blob: Blob): Promise<Chunk[]> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  expect([...bytes.subarray(0, 8)]).toEqual(SIGNATURE)
  const view = new DataView(bytes.buffer)
  const chunks: Chunk[] = []
  let offset = 8
  while (offset < bytes.length) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8))
    chunks.push({
      type,
      data: bytes.subarray(offset + 8, offset + 8 + length),
      crc: view.getUint32(offset + 8 + length),
      crcInput: bytes.subarray(offset + 4, offset + 8 + length),
    })
    offset += 12 + length
  }
  return chunks
}

function ppm(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return { x: view.getUint32(0), y: view.getUint32(4), unit: data[8] }
}

describe('reference CRC', () => {
  it('matches the standard check value', () => {
    // CRC-32 of "123456789" is 0xCBF43926.
    expect(referenceCrc(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    // The IEND chunk CRC every PNG ends with.
    expect(new DataView(IEND.buffer).getUint32(8)).toBe(0xae426082)
  })
})

describe('withPngDensity', () => {
  it('inserts pHYs before the first IDAT with a valid CRC', async () => {
    const out = await withPngDensity(png(IHDR, IDAT, IEND), 300)
    expect(out.type).toBe('image/png')
    const chunks = await readChunks(out)
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'pHYs', 'IDAT', 'IEND'])
    const phys = chunks[1]
    expect(ppm(phys.data)).toEqual({ x: 11811, y: 11811, unit: 1 })
    for (const c of chunks) {
      expect(c.crc).toBe(referenceCrc(c.crcInput))
    }
  })

  it('replaces an existing pHYs rather than duplicating it', async () => {
    const old = chunk('pHYs', [0, 0, 0x0b, 0x13, 0, 0, 0x0b, 0x13, 1])
    const out = await withPngDensity(png(IHDR, old, IDAT, IEND), 600)
    const chunks = await readChunks(out)
    expect(chunks.filter((c) => c.type === 'pHYs')).toHaveLength(1)
    expect(ppm(chunks[1].data).x).toBe(Math.round(600 / 0.0254))
  })

  it('returns non-PNG input untouched', async () => {
    const jpeg = new Blob([
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0]),
    ])
    expect(await withPngDensity(jpeg, 300)).toBe(jpeg)
    const tiny = new Blob([new Uint8Array([137, 80])])
    expect(await withPngDensity(tiny, 300)).toBe(tiny)
  })

  it('returns truncated PNGs untouched', async () => {
    const full = new Uint8Array(await png(IHDR, IDAT, IEND).arrayBuffer())
    const truncated = new Blob([full.subarray(0, 8 + IHDR.length + 6)])
    expect(await withPngDensity(truncated, 300)).toBe(truncated)
    // A PNG with no IDAT/IEND gives nowhere to insert: untouched too.
    const headerOnly = png(IHDR)
    expect(await withPngDensity(headerOnly, 300)).toBe(headerOnly)
  })

  it('ignores invalid dpi', async () => {
    const input = png(IHDR, IDAT, IEND)
    expect(await withPngDensity(input, 0)).toBe(input)
    expect(await withPngDensity(input, NaN)).toBe(input)
  })
})
