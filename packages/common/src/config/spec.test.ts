import { describe, expect, it } from 'vitest'
import { SPEC_TYPE_FILTERS } from '../utils/specSearch'
import { ID_PHOTO_GROUPS, ID_PHOTO_SPECS } from '.'

/** Invariants every entry in spec.json must satisfy. */
describe('spec.json', () => {
  it('has unique names', () => {
    const names = ID_PHOTO_SPECS.map((spec) => spec.name)
    const duplicates = names.filter((name, i) => names.indexOf(name) !== i)
    expect(duplicates).toEqual([])
  })

  it('has positive numeric dimensions', () => {
    const bad = ID_PHOTO_SPECS.filter(({ dimension: d }) =>
      [d.width, d.height, d.dpi].some(
        (value) => typeof value !== 'number' || !(value > 0)
      )
    ).map((spec) => spec.name)
    expect(bad).toEqual([])
  })

  it('has a known unit', () => {
    const bad = ID_PHOTO_SPECS.filter(
      (spec) => !['mm', 'cm', 'inch'].includes(spec.dimension.unit)
    ).map((spec) => spec.name)
    expect(bad).toEqual([])
  })

  it('has head ratios within (0, 1] and min <= max', () => {
    const bad: string[] = []
    for (const spec of ID_PHOTO_SPECS) {
      const rules = spec.rules || {}
      for (const key of [
        'minHeadHeight',
        'maxHeadHeight',
        'minHeadOffset',
        'maxHeadOffset',
        'minChinOffset',
        'maxChinOffset',
        'maxCenterOffset',
      ] as const) {
        const value = rules[key]
        if (value !== undefined && !(value > 0 && value <= 1)) {
          bad.push(`${spec.name}.${key}=${value}`)
        }
      }
      for (const [min, max] of [
        ['minHeadOffset', 'maxHeadOffset'],
        ['minChinOffset', 'maxChinOffset'],
      ] as const) {
        const lo = rules[min]
        const hi = rules[max]
        if (lo !== undefined && hi !== undefined && lo > hi) {
          bad.push(`${spec.name}: ${min} > ${max}`)
        }
      }
      const { minHeadHeight, maxHeadHeight, minHeadOffset = 0 } = rules
      if (
        minHeadHeight !== undefined &&
        maxHeadHeight !== undefined &&
        minHeadHeight > maxHeadHeight
      ) {
        bad.push(`${spec.name}: minHeadHeight > maxHeadHeight`)
      }
      if (maxHeadHeight !== undefined && minHeadOffset + maxHeadHeight > 1) {
        bad.push(`${spec.name}: minHeadOffset + maxHeadHeight > 1`)
      }
    }
    expect(bad).toEqual([])
  })

  it('has min <= max eye height where both are given', () => {
    const bad = ID_PHOTO_SPECS.filter(({ rules }) => {
      const min = rules?.minEyeHeight
      const max = rules?.maxEyeHeight
      return min !== undefined && max !== undefined && min > max
    }).map((spec) => spec.name)
    expect(bad).toEqual([])
  })

  it('keeps the eye line below the crown clearance', () => {
    const bad = ID_PHOTO_SPECS.filter(({ rules }) => {
      const max = rules?.maxEyeHeight
      const offset = rules?.minHeadOffset
      return max !== undefined && offset !== undefined && max > 1 - offset
    }).map((spec) => spec.name)
    expect(bad).toEqual([])
  })

  it('puts every type in a picker group and filter chip', () => {
    const groups = new Set(ID_PHOTO_GROUPS.map((group) => group.name))
    const chips = new Set<string>(SPEC_TYPE_FILTERS)
    const types = new Set(ID_PHOTO_SPECS.map((spec) => spec.type))
    for (const type of types) {
      expect(groups.has(type), type).toBe(true)
      expect(chips.has(type), type).toBe(true)
    }
    const grouped = ID_PHOTO_GROUPS.reduce(
      (sum, group) => sum + group.specs.length,
      0
    )
    expect(grouped).toBe(ID_PHOTO_SPECS.length)
  })
})
