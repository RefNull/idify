import { describe, expect, it } from 'vitest'
import { detectPlatformCapabilities } from '../src/engine/index.js'
import { findSpec, getHeadBounds, loadAllSpecs } from '../src/specs.js'
import type { RawSpec } from '../src/specs.js'
import { framingTargets } from '../src/tools/autoCropRetouch.js'
import { filterSpecs, listSpecs } from '../src/tools/listSpecs.js'
import { applySpecRules, headSizeViolation } from '../src/tools/validateCompliance.js'
import type { ValidationReport } from '../src/tools/validateCompliance.js'

const linux = detectPlatformCapabilities({ platform: 'linux', arch: 'arm64' })

function spec(rules: RawSpec['rules'], extra: Partial<RawSpec> = {}): RawSpec {
  return {
    name: 'test_spec',
    type: 'passport',
    title: 'Test Passport',
    region: 'Testland',
    zone: 'TL',
    dimension: { dpi: 600, width: 827, height: 1063, unit: 'mm' },
    rules,
    background: '#ffffff',
    ...extra,
  }
}

function report(overrides: Partial<ValidationReport> = {}): ValidationReport {
  return {
    faceDetected: true,
    faceCount: 1,
    rollDegrees: 0,
    yawDegrees: 0,
    pitchDegrees: 0,
    qualityScore: 0.9,
    chinYNormalized: 0.85,
    crownYNormalized: 0.1,
    eyeLevelNormalized: 0.45,
    headHeightRatio: 0.75,
    isCentered: true,
    compliant: true,
    violations: [],
    advisories: [],
    engineUsed: 'apple-vision',
    ...overrides,
  }
}

describe('spec loading', () => {
  it('loads and caches the spec database', () => {
    const a = loadAllSpecs()
    expect(a.length).toBeGreaterThan(500)
    expect(loadAllSpecs()).toBe(a)
  })

  it('finds specs case-insensitively and errors clearly otherwise', () => {
    expect(findSpec('UNITED_STATES_PASSPORT').name).toBe('united_states_passport')
    expect(() => findSpec('atlantis_passport')).toThrow(/not found.*list_specs/)
  })
})

describe('list_specs', () => {
  it('filters by ISO zone, country name, type and free text', () => {
    const byZone = filterSpecs({ country: 'AU' })
    expect(byZone.length).toBeGreaterThan(0)
    expect(byZone.every((s) => s.zone === 'AU' || s.region.toLowerCase().includes('au') || s.name.includes('au'))).toBe(true)
    expect(byZone.some((s) => s.name === 'australia_passport')).toBe(true)

    const byName = filterSpecs({ country: 'australia' })
    expect(byName.every((s) => s.region.toLowerCase().includes('australia') || s.name.includes('australia'))).toBe(true)

    const visas = filterSpecs({ type: 'visa' })
    expect(visas.length).toBeGreaterThan(0)
    expect(visas.every((s) => s.type === 'visa')).toBe(true)

    const text = filterSpecs({ query: 'schengen' })
    expect(text.length).toBeGreaterThan(0)
    expect(filterSpecs({ query: 'zzzz-no-match' })).toEqual([])
  })

  it('reports millimetre sizes and head bounds', () => {
    const [au] = filterSpecs({ query: 'australia passport' })
    expect(au.name).toBe('australia_passport')
    expect(au.widthMm).toBe(35)
    expect(au.heightMm).toBe(45)
    expect(au.prohibitBackgroundRemoval).toBe(true)
    expect(au.minHeadHeightMm).toBeCloseTo(32, 0)
    expect(au.maxHeadHeightMm).toBeCloseTo(36, 0)
  })

  it('omits maxHeadHeightMm when the spec has no upper bound', () => {
    const [af] = filterSpecs({ query: 'afghanistan passport' })
    expect(af.maxHeadHeightMm).toBeUndefined()
    expect(af.minHeadHeightMm).toBeGreaterThan(0)
  })

  it('reports the engine up front', () => {
    const result = listSpecs({ country: 'US' }, linux)
    expect(result.engine).toMatchObject({
      name: 'onnx',
      platform: 'linux',
      visionToolsAvailable: true,
      unavailableReason: null,
    })
    expect(result.count).toBe(result.specs.length)
  })
})

describe('getHeadBounds', () => {
  it('reads fractions from spec.rules', () => {
    expect(getHeadBounds(spec({ minHeadHeight: 0.7, maxHeadHeight: 0.8, minHeadOffset: 0.1 }))).toEqual({
      minHead: 0.7,
      maxHead: 0.8,
      crownOffset: 0.1,
    })
  })

  it('treats a missing maxHeadHeight as unbounded', () => {
    expect(getHeadBounds(spec({ minHeadHeight: 0.7 }))).toEqual({
      minHead: 0.7,
      maxHead: null,
      crownOffset: null,
    })
  })

  it('returns null without head rules', () => {
    expect(getHeadBounds(spec(undefined))).toBeNull()
    expect(getHeadBounds(spec({ size: 1 }))).toBeNull()
  })
})

describe('head size checks', () => {
  const bounds = { minHead: 0.7, maxHead: 0.8, crownOffset: 0.1 }

  it('allows a 3% tolerance either side', () => {
    expect(headSizeViolation(0.675, bounds, 'X')).toBeNull()
    expect(headSizeViolation(0.825, bounds, 'X')).toBeNull()
    expect(headSizeViolation(0.65, bounds, 'X')).toMatch(/too small/)
    expect(headSizeViolation(0.85, bounds, 'X')).toMatch(/too large/)
  })

  it('never flags "too large" without an upper bound', () => {
    expect(headSizeViolation(0.99, { ...bounds, maxHead: null }, 'X')).toBeNull()
  })

  it('reports background prohibition as an advisory, not a violation', () => {
    const au = findSpec('australia_passport')
    const result = applySpecRules(report({ headHeightRatio: 0.75 }), au)
    expect(result.violations).toEqual([])
    expect(result.compliant).toBe(true)
    expect(result.advisories.some((a) => /prohibit digital background/.test(a))).toBe(true)
    expect(result.advisories.some((a) => /input image height/.test(a))).toBe(true)
    expect(result.specMatched).toMatchObject({ minHeadHeight: 0.7111, maxHeadHeight: 0.8 })
  })

  it('marks a head-size violation non-compliant', () => {
    const result = applySpecRules(report({ headHeightRatio: 0.4 }), findSpec('australia_passport'))
    expect(result.compliant).toBe(false)
    expect(result.violations[0]).toMatch(/too small/)
  })
})

describe('framing targets', () => {
  it('aims at the middle of a bounded range', () => {
    const t = framingTargets(spec({ minHeadHeight: 0.7, maxHeadHeight: 0.8, minHeadOffset: 0.12 }))
    expect(t.headRatio).toBeCloseTo(0.75)
    expect(t.topMargin).toBe(0.12)
    expect(t.fromSpec).toBe(true)
  })

  it('aims just above the minimum when unbounded', () => {
    expect(framingTargets(spec({ minHeadHeight: 0.7 })).headRatio).toBeCloseTo(0.73)
    expect(framingTargets(spec({ minHeadHeight: 0.33 })).headRatio).toBeCloseTo(0.36)
  })

  it('places the head by the eye band when the spec has one', () => {
    // India OCI / US 2x2: no clear-space rule, eyes 56-69% up.
    const t = framingTargets(findSpec('india_oci_passport'))
    expect(t.topMargin).toBeGreaterThan(0.05)
    expect(t.rules.minEye).toBeGreaterThan(0)
  })

  it('falls back explicitly when the spec has no rules', () => {
    const t = framingTargets(spec(undefined))
    expect(t.headRatio).toBe(0.6)
    expect(t.topMargin).toBeCloseTo(0.16)
    expect(t.fromSpec).toBe(false)
  })
})
