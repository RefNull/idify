import { describe, expect, it } from 'vitest'
import specs from '../config/spec.json'
import { IDPhotoSpec } from '../types'
import { getAutoCropArea } from './autoFrame'
import {
  EYE_IN_HEAD,
  getHeadPlacement,
  getPlacementRules,
  solveCrown,
} from './placement'

const all = specs as unknown as IDPhotoSpec[]
const byName = (name: string) => all.find((s) => s.name === name)!

describe('getHeadPlacement', () => {
  it('places the India OCI head by its eye band, not at the top edge', () => {
    // Official 2x2 in rule: head 25.4-35 mm, eyes 28.5-35 mm from the bottom.
    const p = getHeadPlacement(byName('india_oci_passport'))!
    expect(1 - p.eyes).toBeCloseTo(0.625, 3)
    expect(p.headRatio).toBeCloseTo(0.5945, 3)
    expect(p.crown).toBeGreaterThan(0.05)
    expect(p.chin).toBeLessThan(0.7)
  })

  it('keeps a one-sided eye rule as a bound, not a target', () => {
    // China online: eyes at least 54% up, crown at least 6% down.
    const p = getHeadPlacement(byName('china_passport_online'))!
    expect(p.crown).toBeCloseTo(0.061, 3)
    expect(1 - p.eyes).toBeGreaterThanOrEqual(0.542)
  })

  it('leaves room above the head when a spec gives only a head size', () => {
    const p = getHeadPlacement(byName('india_passport'))!
    expect(p.crown).toBeGreaterThan(0.03)
    expect(p.chin).toBeLessThanOrEqual(1)
  })

  it.each(['finland_passport', 'finland_passport_online'])(
    'places the %s head inside the Finnish Police bands',
    (name) => {
      // Poliisin passikuvaohje 2020: head 32-36 mm, 4-6 mm above the crown,
      // 7-9 mm below the chin, on a 47 mm tall photo (653 px online).
      const spec = byName(name)
      const H = name.endsWith('online') ? 653 : 47
      const mm = H / 47
      const p = getHeadPlacement(spec)!
      const rules = getPlacementRules(spec)
      expect(solveCrown(rules, p.headRatio).fits).toBe(true)
      expect(p.headRatio * H).toBeGreaterThanOrEqual(32 * mm - 0.5)
      expect(p.headRatio * H).toBeLessThanOrEqual(36 * mm + 0.5)
      expect(p.crown * H).toBeGreaterThanOrEqual(4 * mm - 0.5)
      expect(p.crown * H).toBeLessThanOrEqual(6 * mm + 0.5)
      expect((1 - p.chin) * H).toBeGreaterThanOrEqual(7 * mm - 0.5)
      expect((1 - p.chin) * H).toBeLessThanOrEqual(9 * mm + 0.5)
    }
  )

  it.each(all.filter((s) => getHeadPlacement(s)).map((s) => [s.name, s] as const))(
    '%s: meets every rule that can be met',
    (_name, spec) => {
      const p = getHeadPlacement(spec)!
      const rules = getPlacementRules(spec)
      const { fits } = solveCrown(rules, p.headRatio)
      expect(p.crown).toBeGreaterThanOrEqual(rules.crownOffset - 1e-9)
      if (!fits) return
      expect(p.chin).toBeLessThanOrEqual(1 + 1e-9)
      if (rules.minEye > 0) expect(1 - p.eyes).toBeGreaterThanOrEqual(rules.minEye - 1e-9)
      if (rules.maxEye > 0) expect(1 - p.eyes).toBeLessThanOrEqual(rules.maxEye + 1e-9)
    }
  )

  it('can meet the rules of nearly every spec', () => {
    const misfits = all.filter((s) => {
      const p = getHeadPlacement(s)
      return p && !solveCrown(getPlacementRules(s), p.headRatio).fits
    })
    expect(misfits.map((s) => s.name)).toEqual([])
  })
})

describe('guide and auto-framing agree', () => {
  it.each(all.filter((s) => getHeadPlacement(s)).map((s) => [s.name, s] as const))(
    '%s',
    (_name, spec) => {
      const p = getHeadPlacement(spec)!
      // A typical head well inside a large photo, so nothing is clamped.
      const head = { top: 0.4, bottom: 0.5, centerX: 0.5, eyes: 0.4 + EYE_IN_HEAD * 0.1 }
      const image = { width: 100000, height: 100000 }
      const area = getAutoCropArea(head, spec, image)
      expect(10000 / area.height).toBeCloseTo(p.headRatio, 3)
      expect((40000 - area.y) / area.height).toBeCloseTo(p.crown, 3)
    }
  )
})
