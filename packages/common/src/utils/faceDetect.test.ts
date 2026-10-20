import { describe, expect, it } from 'vitest'
import { decodeYuNet, letterbox, toImageFraction } from './faceDetect'

const SIZE = 64

/** Empty YuNet outputs for a SIZE x SIZE input. */
function outputs() {
  const result: Record<string, Float32Array> = {}
  for (const stride of [8, 16, 32]) {
    const cells = (SIZE / stride) ** 2
    result[`cls_${stride}`] = new Float32Array(cells)
    result[`obj_${stride}`] = new Float32Array(cells)
    result[`bbox_${stride}`] = new Float32Array(cells * 4)
    result[`kps_${stride}`] = new Float32Array(cells * 10)
  }
  return result
}

describe('decodeYuNet', () => {
  it('decodes a box and landmarks relative to their grid cell', () => {
    const o = outputs()
    // Stride 16, row 1, column 2 (cell index 1 * 4 + 2 = 6).
    const i = 6
    o.cls_16[i] = 0.9
    o.obj_16[i] = 0.9
    o.bbox_16.set([0.5, 0.5, Math.log(2), Math.log(3)], i * 4)
    o.kps_16.set([0.25, 0.5, 0.75, 0.5, 0.5, 1, 0.25, 1.5, 0.75, 1.5], i * 10)
    const [face] = decodeYuNet(o, SIZE)
    // Centre (2.5, 1.5) * 16 = (40, 24); size 32 x 48.
    expect(face.x).toBeCloseTo(24)
    expect(face.y).toBeCloseTo(0)
    expect(face.width).toBeCloseTo(32)
    expect(face.height).toBeCloseTo(48)
    expect(face.score).toBeCloseTo(0.9)
    expect(face.landmarks[0]).toEqual([36, 24])
    expect(face.landmarks[1]).toEqual([44, 24])
  })

  it('drops weak detections and merges overlapping ones', () => {
    const o = outputs()
    o.cls_8[0] = 0.3
    o.obj_8[0] = 0.3
    o.cls_8[9] = 0.9
    o.obj_8[9] = 0.9
    o.cls_8[10] = 0.8
    o.obj_8[10] = 0.8
    // Two neighbouring cells predicting large, overlapping boxes.
    o.bbox_8.set([0, 0, Math.log(4), Math.log(4)], 9 * 4)
    o.bbox_8.set([0, 0, Math.log(4), Math.log(4)], 10 * 4)
    const faces = decodeYuNet(o, SIZE)
    expect(faces).toHaveLength(1)
    expect(faces[0].score).toBeCloseTo(0.9)
  })
})

describe('letterbox and toImageFraction', () => {
  it('maps model pixels back to fractions of the source image', () => {
    const box = letterbox(1000, 2000, 640)
    expect(box).toEqual({ scale: 0.32, width: 320, height: 640 })
    const face = toImageFraction(
      {
        x: 80,
        y: 160,
        width: 160,
        height: 320,
        score: 1,
        landmarks: [[160, 320]],
      },
      box
    )
    expect(face).toMatchObject({ x: 0.25, y: 0.25, width: 0.5, height: 0.5 })
    expect(face.landmarks[0]).toEqual([0.5, 0.5])
  })
})
