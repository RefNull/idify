import { describe, expect, it } from 'vitest'
import {
  encodeWithinSize,
  getFileSizeExcess,
  hasGradientBackground,
  isNonNeutralAdjustment,
  isStrictSpec,
} from './compliance'

describe('compliance warnings', () => {
  it('applies to passport and visa specs only', () => {
    expect(isStrictSpec({ type: 'passport' })).toBe(true)
    expect(isStrictSpec({ type: 'visa' })).toBe(true)
    expect(isStrictSpec({ type: 'identification' })).toBe(false)
    expect(isStrictSpec(undefined)).toBe(false)
  })

  it('treats the filter presets correctly', () => {
    // Original and Clear are neutral.
    expect(isNonNeutralAdjustment({})).toBe(false)
    expect(
      isNonNeutralAdjustment({
        saturation: 0,
        sepia: 0,
        vibrance: 0,
        contrast: 0.15,
        brightness: 0.05,
      })
    ).toBe(false)
    // B&W, sepia, vivid and noise are not.
    expect(isNonNeutralAdjustment({ saturation: -1 })).toBe(true)
    expect(isNonNeutralAdjustment({ sepia: 0.8 })).toBe(true)
    expect(isNonNeutralAdjustment({ saturation: 0.25, vibrance: 0.3 })).toBe(
      true
    )
    expect(isNonNeutralAdjustment({ noise: 0.2 })).toBe(true)
  })

  it('detects gradient backgrounds the same way they are drawn', () => {
    const bg = (brightness: number, color = '#ffffff') => ({
      color,
      gradient: { angle: 'c' as const, brightness },
    })
    expect(hasGradientBackground(bg(0))).toBe(false)
    expect(hasGradientBackground(bg(0.05))).toBe(false)
    expect(hasGradientBackground(bg(0.1))).toBe(true)
    expect(hasGradientBackground(bg(-2))).toBe(true)
    expect(hasGradientBackground(bg(2, 'transparent'))).toBe(false)
  })
})

describe('getFileSizeExcess', () => {
  it('reports only files over the spec limit', () => {
    expect(getFileSizeExcess(500 * 1024, {})).toBeNull()
    expect(getFileSizeExcess(240 * 1024, { rules: { size: 240 } })).toBeNull()
    expect(getFileSizeExcess(240 * 1024 + 1, { rules: { size: 240 } })).toEqual(
      {
        actualKB: 241,
        maxKB: 240,
      }
    )
    expect(getFileSizeExcess(10, undefined)).toBeNull()
  })
})

describe('encodeWithinSize', () => {
  // A fake encoder whose output grows with quality: 1000 bytes per 0.01.
  const encode = async (quality: number) =>
    new Blob([new Uint8Array(Math.round(quality * 100_000))])

  it('keeps the top quality when it already fits', async () => {
    const blob = await encodeWithinSize(encode, 200_000)
    expect(blob.size).toBe(95_000)
  })

  it('finds the highest quality under the limit', async () => {
    const blob = await encodeWithinSize(encode, 70_000)
    expect(blob.size).toBeLessThanOrEqual(70_000)
    expect(blob.size).toBeGreaterThan(65_000)
  })

  it('returns the smallest file when nothing fits', async () => {
    const blob = await encodeWithinSize(encode, 10_000)
    expect(blob.size).toBe(50_000)
  })
})
