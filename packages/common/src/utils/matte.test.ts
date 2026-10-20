import { describe, expect, it } from 'vitest'
import { refineMatte, tightenAlpha } from './matte'

function pixels(rows: [number, number, number, number][][]) {
  const height = rows.length
  const width = rows[0].length
  const data = new Uint8ClampedArray(width * height * 4)
  rows.flat().forEach((px, i) => data.set(px, i * 4))
  return { data, width, height }
}

function at(data: Uint8ClampedArray, width: number, x: number, y: number) {
  const i = (y * width + x) * 4
  return Array.from(data.slice(i, i + 4))
}

const SKIN: [number, number, number, number] = [200, 150, 120, 255]
const CLEAR: [number, number, number, number] = [0, 0, 0, 0]

describe('tightenAlpha', () => {
  it('clamps below low and above high', () => {
    expect(tightenAlpha(10, 48, 208)).toBe(0)
    expect(tightenAlpha(48, 48, 208)).toBe(0)
    expect(tightenAlpha(208, 48, 208)).toBe(255)
    expect(tightenAlpha(255, 48, 208)).toBe(255)
  })

  it('maps the middle linearly', () => {
    expect(tightenAlpha(128, 48, 208)).toBe(128)
  })
})

describe('refineMatte', () => {
  it('replaces the backdrop colour in the edge band with the subject colour', () => {
    // Opaque skin on the left, a white-contaminated soft edge, then nothing.
    const { data, width, height } = pixels([
      [
        SKIN,
        SKIN,
        [240, 230, 225, 180],
        [250, 250, 250, 100],
        [255, 255, 255, 30],
        CLEAR,
      ],
      [
        SKIN,
        SKIN,
        [240, 230, 225, 180],
        [250, 250, 250, 100],
        [255, 255, 255, 30],
        CLEAR,
      ],
    ])
    refineMatte(data, width, height)
    const edge = at(data, width, 3, 0)
    // Colour now close to skin, not white.
    expect(edge[0]).toBeLessThan(215)
    expect(edge[2]).toBeLessThan(140)
    expect(edge[3]).toBe(83) // (100 - 48) / 160 * 255
    // Faint pixel dropped entirely.
    expect(at(data, width, 4, 0)[3]).toBe(0)
    // Opaque pixels untouched.
    expect(at(data, width, 0, 0)).toEqual(SKIN)
  })

  it('carries colour across several rings of edge pixels', () => {
    const row: [number, number, number, number][] = [SKIN]
    for (let i = 0; i < 6; i++) row.push([255, 255, 255, 120])
    const { data, width, height } = pixels([row])
    refineMatte(data, width, height)
    for (let x = 1; x < 7; x++) {
      // Alpha 115 keeps ~9% of its own (white) colour; the rest is skin.
      const [r, g, b] = at(data, width, x, 0)
      expect(r).toBeLessThanOrEqual(206)
      expect(g).toBeLessThanOrEqual(160)
      expect(b).toBeLessThanOrEqual(133)
    }
  })

  it('leaves edge pixels with no opaque neighbour anywhere alone', () => {
    const { data, width, height } = pixels([
      [
        [255, 255, 255, 120],
        [255, 255, 255, 120],
      ],
    ])
    refineMatte(data, width, height)
    expect(at(data, width, 0, 0)).toEqual([255, 255, 255, 115])
  })

  it('is a no-op on fully opaque images', () => {
    const { data, width, height } = pixels([[SKIN, SKIN]])
    refineMatte(data, width, height)
    expect(at(data, width, 1, 0)).toEqual(SKIN)
  })
})
