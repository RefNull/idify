import { detectPlatformCapabilities } from '../engine/index.js'
import type { PlatformCapabilities } from '../engine/index.js'
import { getHeadBounds, loadAllSpecs, specSizeMm } from '../specs.js'

export interface ListSpecsParams {
  country?: string
  type?: string
  query?: string
}

export interface SpecSummary {
  name: string
  title: string
  type: string
  region: string
  zone: string
  flag?: string
  dimension: { width: number; height: number; unit: string; dpi: number }
  widthMm: number
  heightMm: number
  minHeadHeightMm?: number
  maxHeadHeightMm?: number
  background: string
  prohibitBackgroundRemoval: boolean
  comment?: string
}

export interface ListSpecsResult {
  engine: {
    name: PlatformCapabilities['engine']
    platform: string
    arch: string
    visionToolsAvailable: boolean
    unavailableReason: string | null
  }
  count: number
  specs: SpecSummary[]
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function filterSpecs(params: ListSpecsParams = {}): SpecSummary[] {
  const countryQuery = (params.country || '').trim().toLowerCase()
  const typeQuery = (params.type || '').trim().toLowerCase()
  const textQuery = (params.query || '').trim().toLowerCase()

  return loadAllSpecs()
    .filter((spec) => {
      if (countryQuery) {
        const matchRegion = spec.region?.toLowerCase().includes(countryQuery)
        const matchZone = spec.zone?.toLowerCase() === countryQuery
        const matchName = spec.name?.toLowerCase().includes(countryQuery)
        if (!matchRegion && !matchZone && !matchName) return false
      }
      if (typeQuery && spec.type?.toLowerCase() !== typeQuery) return false
      if (textQuery) {
        const inTitle = spec.title?.toLowerCase().includes(textQuery)
        const inRegion = spec.region?.toLowerCase().includes(textQuery)
        const inName = spec.name?.toLowerCase().includes(textQuery)
        if (!inTitle && !inRegion && !inName) return false
      }
      return true
    })
    .map((spec) => {
      const { widthMm, heightMm } = specSizeMm(spec)
      const bounds = getHeadBounds(spec)
      return {
        name: spec.name,
        title: spec.title,
        type: spec.type,
        region: spec.region,
        zone: spec.zone,
        flag: spec.flag,
        dimension: spec.dimension,
        widthMm: round1(widthMm),
        heightMm: round1(heightMm),
        minHeadHeightMm: bounds ? round1(bounds.minHead * heightMm) : undefined,
        maxHeadHeightMm:
          bounds && bounds.maxHead !== null ? round1(bounds.maxHead * heightMm) : undefined,
        background: spec.background,
        prohibitBackgroundRemoval: Boolean(spec.prohibitBackgroundRemoval),
        comment: spec.comment,
      }
    })
}

export function listSpecs(
  params: ListSpecsParams = {},
  capabilities: PlatformCapabilities = detectPlatformCapabilities()
): ListSpecsResult {
  const specs = filterSpecs(params)
  return {
    engine: {
      name: capabilities.engine,
      platform: capabilities.platform,
      arch: capabilities.arch,
      visionToolsAvailable: capabilities.engine !== 'none',
      unavailableReason: capabilities.unavailableReason,
    },
    count: specs.length,
    specs,
  }
}
