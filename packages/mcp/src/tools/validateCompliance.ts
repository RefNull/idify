import { requireVisionEngine } from '../engine/index.js'
import type { ComplianceResult } from '../engine/index.js'
import { IMAGE_EXTENSIONS, assertImageFile, resolveSafePath } from '../pathGuard.js'
import { findSpec, getHeadBounds } from '../specs.js'
import type { HeadBounds, RawSpec } from '../specs.js'
import type { ToolDeps } from './shared.js'

export interface ValidateComplianceParams {
  image_path: string
  spec_name?: string
}

export interface ValidationReport extends ComplianceResult {
  specMatched?: {
    name: string
    title: string
    prohibitBackgroundRemoval: boolean
    minHeadHeight: number | null
    maxHeadHeight: number | null
  }
}

/** Allowed slack around the spec's head-height fractions. */
export const HEAD_RATIO_TOLERANCE = 0.03

/**
 * Check a measured head-height fraction against a spec's bounds. Returns the
 * violation text, or null when it is within bounds (or there are none).
 */
export function headSizeViolation(
  headHeightRatio: number,
  bounds: HeadBounds | null,
  title: string
): string | null {
  if (!bounds) return null
  const pct = (n: number) => `${Math.round(n * 100)}%`
  if (headHeightRatio < bounds.minHead - HEAD_RATIO_TOLERANCE) {
    return `Head is too small for ${title} (${pct(headHeightRatio)} < ${pct(bounds.minHead)} of photo height)`
  }
  if (bounds.maxHead !== null && headHeightRatio > bounds.maxHead + HEAD_RATIO_TOLERANCE) {
    return `Head is too large for ${title} (${pct(headHeightRatio)} > ${pct(bounds.maxHead)} of photo height)`
  }
  return null
}

/** Layer a spec's rules on top of the engine's spec-independent report. */
export function applySpecRules(report: ValidationReport, spec: RawSpec): ValidationReport {
  const bounds = getHeadBounds(spec)
  const prohibitBg = Boolean(spec.prohibitBackgroundRemoval)
  const violations = [...report.violations]
  const advisories = [...report.advisories]

  report.specMatched = {
    name: spec.name,
    title: spec.title,
    prohibitBackgroundRemoval: prohibitBg,
    minHeadHeight: bounds?.minHead ?? null,
    maxHeadHeight: bounds?.maxHead ?? null,
  }

  if (report.faceDetected) {
    const violation = headSizeViolation(report.headHeightRatio, bounds, spec.title)
    if (violation) violations.push(violation)
    advisories.push(
      'headHeightRatio is measured against the input image height; the head-size check is only meaningful for a photo already cropped to this spec (e.g. the output of auto_crop_and_retouch).'
    )
  }
  if (!bounds) {
    advisories.push(`${spec.title} defines no head-size rules; head size was not checked.`)
  }
  if (prohibitBg) {
    advisories.push(
      `Official rules for ${spec.title} prohibit digital background removal or replacement; submit a photo taken against the required background.`
    )
  }

  return { ...report, violations, advisories, compliant: violations.length === 0 }
}

export async function validatePhotoCompliance(
  params: ValidateComplianceParams,
  deps: ToolDeps = {}
): Promise<ValidationReport> {
  const engine = deps.engine ?? requireVisionEngine(deps.capabilities)
  const spec = params.spec_name ? findSpec(params.spec_name) : null
  const imagePath = resolveSafePath(params.image_path, {
    label: 'image_path',
    mode: 'read',
    extensions: IMAGE_EXTENSIONS,
  })
  assertImageFile(imagePath, 'image_path')

  // Measurements an engine skips come back null, with an advisory.
  const report: ValidationReport = await engine.inspect(imagePath)
  return spec ? applySpecRules(report, spec) : report
}
