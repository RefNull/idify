import { describe, expect, it } from 'vitest'
import {
  MAX_CANVAS_PIXELS,
  applyMatrix,
  getCropOutputSize,
  getCropTransform,
  pickOutputScale,
  rotatedBoundingBox,
} from './crop'

function close(actual: { x: number; y: number }, x: number, y: number) {
  expect(actual.x).toBeCloseTo(x, 6)
  expect(actual.y).toBeCloseTo(y, 6)
}

const W = 400
const H = 300

describe('rotatedBoundingBox', () => {
  it('swaps sides at 90 degrees and grows at 45', () => {
    const r90 = rotatedBoundingBox(W, H, 90)
    expect(r90.width).toBeCloseTo(H)
    expect(r90.height).toBeCloseTo(W)
    const r45 = rotatedBoundingBox(100, 100, 45)
    expect(r45.width).toBeCloseTo(100 * Math.SQRT2)
  })
})

describe('getCropTransform', () => {
  const area = { x: 10, y: 20, width: 100, height: 200 }

  it('maps the crop area onto the output without rotation or flip', () => {
    const m = getCropTransform({
      imageWidth: W,
      imageHeight: H,
      rotation: 0,
      area,
      outputWidth: 300,
      outputHeight: 600,
    })
    close(applyMatrix(m, 10, 20), 0, 0)
    close(applyMatrix(m, 110, 220), 300, 600)
  })

  it('mirrors about the image centre for a horizontal flip', () => {
    const m = getCropTransform({
      imageWidth: W,
      imageHeight: H,
      rotation: 0,
      flipHorizontal: true,
      area,
      outputWidth: 100,
      outputHeight: 200,
    })
    // The preview shows image pixel (W - x, y) where (x, y) used to be.
    close(applyMatrix(m, W - 10, 20), 0, 0)
    close(applyMatrix(m, W - 110, 220), 100, 200)
  })

  it('mirrors vertically for a vertical flip', () => {
    const m = getCropTransform({
      imageWidth: W,
      imageHeight: H,
      rotation: 0,
      flipVertical: true,
      area,
      outputWidth: 100,
      outputHeight: 200,
    })
    close(applyMatrix(m, 10, H - 20), 0, 0)
  })

  it('rotates clockwise into the rotated bounding box', () => {
    // At 90 degrees the bounding box is H x W and the image's top-left
    // corner ends up at the top-right.
    const m = getCropTransform({
      imageWidth: W,
      imageHeight: H,
      rotation: 90,
      area: { x: 0, y: 0, width: H, height: W },
      outputWidth: H,
      outputHeight: W,
    })
    close(applyMatrix(m, 0, 0), H, 0)
    close(applyMatrix(m, W, 0), H, W)
    close(applyMatrix(m, 0, H), 0, 0)
  })

  it('flips in the image frame before rotating (as the CSS preview does)', () => {
    // rotateZ(90) rotateY(180): mirror first, then rotate. The top-left
    // corner is mirrored to the top-right, which rotates to bottom-right.
    const m = getCropTransform({
      imageWidth: W,
      imageHeight: H,
      rotation: 90,
      flipHorizontal: true,
      area: { x: 0, y: 0, width: H, height: W },
      outputWidth: H,
      outputHeight: W,
    })
    close(applyMatrix(m, 0, 0), H, W)
  })

  it('treats both flips as a 180 degree turn', () => {
    const options = {
      imageWidth: W,
      imageHeight: H,
      area,
      outputWidth: 100,
      outputHeight: 200,
    }
    const flipped = getCropTransform({
      ...options,
      rotation: 30,
      flipHorizontal: true,
      flipVertical: true,
    })
    const turned = getCropTransform({ ...options, rotation: 210 })
    flipped.forEach((value, i) => expect(value).toBeCloseTo(turned[i], 6))
  })

  it('scales by output size over area size', () => {
    const m = getCropTransform({
      imageWidth: W,
      imageHeight: H,
      rotation: 0,
      area: { x: 0, y: 0, width: 100, height: 100 },
      outputWidth: 300,
      outputHeight: 300,
    })
    expect(m[0]).toBeCloseTo(3)
    expect(m[3]).toBeCloseTo(3)
  })
})

describe('output scale cap', () => {
  it('uses 3x when it fits', () => {
    expect(pickOutputScale(413, 531)).toBe(3)
  })

  it('falls back to 2x for the HK e-passport (1200x1600 * 3 = 17.3 MP)', () => {
    expect(1200 * 3 * 1600 * 3).toBeGreaterThan(MAX_CANVAS_PIXELS)
    expect(pickOutputScale(1200, 1600)).toBe(2)
  })

  it('falls back to 1x, then below 1x only when needed', () => {
    expect(pickOutputScale(3000, 3000)).toBe(1)
    const scale = pickOutputScale(10000, 10000)
    expect(scale).toBeLessThan(1)
    const size = getCropOutputSize({ width: 10000, height: 10000 })
    expect(size.width * size.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
    expect(size.width).toBe(size.height)
  })

  it('never exceeds the limit for any spec-sized input', () => {
    for (const [w, h] of [
      [1, 1],
      [1366, 1366],
      [2000, 2999],
      [4097, 4096],
      [10000, 1],
    ]) {
      const size = getCropOutputSize({ width: w, height: h })
      expect(size.width * size.height).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
      expect(size.width).toBeGreaterThanOrEqual(1)
      expect(size.height).toBeGreaterThanOrEqual(1)
    }
  })
})
