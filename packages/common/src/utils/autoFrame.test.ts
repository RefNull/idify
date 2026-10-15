import { describe, expect, it } from 'vitest'
import { findCrownInMask, getAutoCropArea, getHeadBox } from './autoFrame'
import { IDPhotoSpec } from '../types'

/** A face 200 px wide in a 1000 x 1000 photo: eyes at y=400, chin at y=550. */
const face = {
  x: 0.4,
  y: 0.33,
  width: 0.2,
  height: 0.22,
  landmarks: [
    [0.45, 0.4],
    [0.55, 0.4],
    [0.5, 0.46],
    [0.46, 0.5],
    [0.54, 0.5],
  ] as [number, number][],
}

/** Mask with a solid block from `top` down, across the middle columns. */
function maskFrom(top: number, size = 100) {
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = top; y < size; y++) {
    for (let x = 30; x < 70; x++) data[(y * size + x) * 4 + 3] = 255
  }
  return { data, width: size, height: size }
}

describe('getHeadBox', () => {
  it('takes the chin from the face box and centres on the eyes', () => {
    const head = getHeadBox(face)
    expect(head.bottom).toBeCloseTo(0.55)
    expect(head.centerX).toBeCloseTo(0.5)
  })

  it('estimates the crown from the eye line without a mask', () => {
    // Eye-to-chin 0.15, crown 1.05 of that above the eyes.
    expect(getHeadBox(face).top).toBeCloseTo(0.4 - 0.1575)
  })

  it('uses the mask for the crown when it has one', () => {
    expect(getHeadBox(face, maskFrom(20)).top).toBeCloseTo(0.2)
  })

  it('ignores a mask that reaches far above the head', () => {
    // Mask from the very top (e.g. raised hand): capped at 1.8x eye-to-chin.
    expect(getHeadBox(face, maskFrom(0)).top).toBeCloseTo(0.4 - 0.27)
  })
})

describe('findCrownInMask', () => {
  it('returns null when nothing is above the face', () => {
    const empty = {
      data: new Uint8ClampedArray(100 * 100 * 4),
      width: 100,
      height: 100,
    }
    expect(findCrownInMask(empty, face)).toBeNull()
  })
})

const spec = {
  dimension: { width: 600, height: 600, dpi: 300, unit: 'inch' },
  rules: { minHeadHeight: 0.5, maxHeadHeight: 0.7, minHeadOffset: 0.05 },
} as Pick<IDPhotoSpec, 'dimension' | 'rules'>

describe('getAutoCropArea', () => {
  const image = { width: 1000, height: 1000 }

  it('sizes the crop so the head fills the middle of the allowed range', () => {
    const head = { top: 0.2, bottom: 0.5, centerX: 0.5 }
    const area = getAutoCropArea(head, spec, image)
    // Head 300 px at 60% of the photo height.
    expect(area.height).toBeCloseTo(500)
    expect(area.width).toBeCloseTo(500)
    expect(area.x).toBeCloseTo(250)
  })

  it('puts the crown on the required clear-space line', () => {
    const head = { top: 0.2, bottom: 0.5, centerX: 0.5 }
    const area = getAutoCropArea(
      head,
      { ...spec, rules: { ...spec.rules, minHeadOffset: 0.1 } },
      image
    )
    expect((200 - area.y) / area.height).toBeCloseTo(0.1)
  })

  it('puts the eye line in the middle of the eye-height range', () => {
    const head = { top: 0.2, bottom: 0.5, centerX: 0.5, eyes: 0.35 }
    const area = getAutoCropArea(
      head,
      {
        dimension: spec.dimension,
        rules: {
          minHeadHeight: 0.5,
          maxHeadHeight: 0.7,
          minEyeHeight: 0.56,
          maxEyeHeight: 0.68,
        },
      },
      image
    )
    // Eyes 62% up from the bottom edge.
    expect((area.y + area.height - 350) / area.height).toBeCloseTo(0.62)
  })

  it('falls back to a generic framing without rules', () => {
    const head = { top: 0.1, bottom: 0.4, centerX: 0.5 }
    const area = getAutoCropArea(head, { dimension: spec.dimension }, image)
    expect(area.height).toBeCloseTo(500)
    // 40% of the 40% free space above the crown.
    expect((100 - area.y) / area.height).toBeCloseTo(0.16)
  })

  it('zooms in, then stops at the photo edge, when the head is near the top', () => {
    // Crown 10 px from the top: even a 70% head needs 21 px of clear space.
    const head = { top: 0.01, bottom: 0.31, centerX: 0.5 }
    const area = getAutoCropArea(head, spec, image)
    expect(area.y).toBe(0)
    expect(300 / area.height).toBeCloseTo(0.7)
  })
})
