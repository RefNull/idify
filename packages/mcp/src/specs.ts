import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MM_PER_INCH } from './sheet.js'

export interface RawSpec {
  name: string
  type: string
  title: string
  region: string
  zone: string
  flag?: string
  dimension: { dpi: number; width: number; height: number; unit: string }
  rules?: {
    size?: number
    minHeadHeight?: number
    minHeadOffset?: number
    maxHeadHeight?: number
    minEyeHeight?: number
    maxEyeHeight?: number
  }
  background: string
  comment?: string
  prohibitBackgroundRemoval?: boolean
}

/**
 * Where spec.json is looked for, in order:
 *  1. dist/data/spec.json, copied there by `pnpm build` (works when the
 *     package is installed or linked anywhere);
 *  2. the @idify/common source in this monorepo (running from src in tests).
 */
export const SPEC_CANDIDATES = [
  new URL('./data/spec.json', import.meta.url),
  new URL('../../common/src/config/spec.json', import.meta.url),
]

let cache: RawSpec[] | null = null

export function loadAllSpecs(): RawSpec[] {
  if (cache) return cache
  const found = SPEC_CANDIDATES.map((url) => fileURLToPath(url)).find((p) =>
    fs.existsSync(p)
  )
  if (!found) {
    throw new Error(
      `Spec database not found (looked in ${SPEC_CANDIDATES.map((u) => fileURLToPath(u)).join(', ')}). Rebuild with "pnpm --filter @idify/mcp build".`
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(found, 'utf8'))
  } catch (err) {
    throw new Error(
      `Spec database at ${found} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Spec database at ${found} is not an array`)
  }
  cache = parsed as RawSpec[]
  return cache
}

export function findSpec(name: string): RawSpec {
  const wanted = name.trim().toLowerCase()
  const spec = loadAllSpecs().find((s) => s.name?.toLowerCase() === wanted)
  if (!spec) {
    throw new Error(`Spec "${name}" not found. Use list_specs to find a valid spec name.`)
  }
  return spec
}

export function specSizeMm(spec: RawSpec): { widthMm: number; heightMm: number } {
  const dpi = spec.dimension.dpi
  return {
    widthMm: (spec.dimension.width / dpi) * MM_PER_INCH,
    heightMm: (spec.dimension.height / dpi) * MM_PER_INCH,
  }
}

export interface HeadBounds {
  /** Minimum chin-to-crown height, as a fraction of the photo height. */
  minHead: number
  /** Maximum chin-to-crown height as a fraction, or null when the spec sets none. */
  maxHead: number | null
  /** Minimum clear space above the crown, as a fraction, or null when unset. */
  crownOffset: number | null
}

/**
 * The single source of head-size rules for every tool. Same semantics as
 * getHeadGuideMetrics in @idify/common/utils/pure: rules are fractions of the
 * photo height, a missing or zero maxHeadHeight means "unbounded", and a spec
 * with no head rules yields null.
 */
export function getHeadBounds(spec: RawSpec): HeadBounds | null {
  const rules = spec.rules
  if (!rules) return null
  const { minHeadHeight = 0, maxHeadHeight = 0, minHeadOffset = 0 } = rules
  if (minHeadHeight <= 0 && maxHeadHeight <= 0) return null
  return {
    minHead: minHeadHeight,
    maxHead: maxHeadHeight > 0 ? maxHeadHeight : null,
    crownOffset: minHeadOffset > 0 ? minHeadOffset : null,
  }
}
