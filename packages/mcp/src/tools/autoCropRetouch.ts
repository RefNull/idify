import { requireVisionEngine } from '../engine/index.js'
import type { ProcessPhotoResult } from '../engine/index.js'
import {
  IMAGE_EXTENSIONS,
  assertImageFile,
  ensureParentDir,
  resolveSafePath,
} from '../pathGuard.js'
import { findSpec, getHeadBounds } from '../specs.js'
import type { RawSpec } from '../specs.js'
import { normalizeHex } from './shared.js'
import type { ToolDeps } from './shared.js'

export interface AutoCropRetouchParams {
  input_path: string
  output_path: string
  spec_name: string
  background_color?: string
  auto_frame?: boolean
  dpi?: number
  overwrite?: boolean
}

export interface AutoCropRetouchResult extends ProcessPhotoResult {
  specName: string
  specTitle: string
  backgroundPolicy: string
  targetHeadRatio: number
  advisories: string[]
}

/** Used only when a spec carries no head rules at all. */
const FALLBACK_HEAD_RATIO = 0.6
const FALLBACK_TOP_MARGIN = 0.1

/** Head height (fraction of photo height) and crown margin to frame to. */
export function framingTargets(spec: RawSpec): {
  headRatio: number
  topMargin: number
  /** Eye line from the bottom edge, for specs with an eye-height rule. */
  eyeHeight?: number
  fromSpec: boolean
} {
  const bounds = getHeadBounds(spec)
  if (!bounds) {
    return { headRatio: FALLBACK_HEAD_RATIO, topMargin: FALLBACK_TOP_MARGIN, fromSpec: false }
  }
  const { minEyeHeight = 0, maxEyeHeight = 0 } = spec.rules ?? {}
  const eyeHeight =
    minEyeHeight > 0 && maxEyeHeight > 0
      ? (minEyeHeight + maxEyeHeight) / 2
      : Math.max(minEyeHeight, maxEyeHeight)
  // Aim for the middle of the permitted range; with no upper bound, aim a
  // little above the minimum.
  const headRatio =
    bounds.maxHead !== null
      ? (bounds.minHead + bounds.maxHead) / 2
      : Math.min(bounds.minHead + 0.05, 0.95)
  return {
    headRatio,
    topMargin: bounds.crownOffset ?? FALLBACK_TOP_MARGIN,
    ...(eyeHeight > 0 ? { eyeHeight } : {}),
    fromSpec: true,
  }
}

export async function autoCropAndRetouch(
  params: AutoCropRetouchParams,
  deps: ToolDeps = {}
): Promise<AutoCropRetouchResult> {
  const engine = deps.engine ?? requireVisionEngine(deps.capabilities)
  const spec = findSpec(params.spec_name)

  const inputPath = resolveSafePath(params.input_path, {
    label: 'input_path',
    mode: 'read',
    extensions: IMAGE_EXTENSIONS,
  })
  assertImageFile(inputPath, 'input_path')
  const outputPath = resolveSafePath(params.output_path, {
    label: 'output_path',
    mode: 'write',
    extensions: IMAGE_EXTENSIONS,
    overwrite: params.overwrite === true,
  })
  if (outputPath === inputPath) {
    throw new Error('output_path must differ from input_path')
  }

  // Keep the spec's physical size: a different DPI scales the pixel size.
  const specDpi = spec.dimension.dpi
  const dpi = params.dpi ?? specDpi
  const targetWidth = Math.round((spec.dimension.width / specDpi) * dpi)
  const targetHeight = Math.round((spec.dimension.height / specDpi) * dpi)

  const advisories: string[] = []
  const { headRatio, topMargin, eyeHeight, fromSpec } = framingTargets(spec)
  if (!fromSpec) {
    advisories.push(`${spec.title} defines no head-size rules; framed to a generic ${FALLBACK_HEAD_RATIO * 100}% head height.`)
  }

  let bgColor: string
  let backgroundPolicy: string
  if (spec.prohibitBackgroundRemoval) {
    bgColor = 'none'
    backgroundPolicy =
      'original-preserved (digital background replacement is prohibited by the official spec)'
    if (params.background_color && params.background_color.toLowerCase() !== 'none') {
      advisories.push(
        `background_color was ignored: ${spec.title} prohibits digital background replacement.`
      )
    }
  } else if (params.background_color) {
    bgColor =
      params.background_color.toLowerCase() === 'none'
        ? 'none'
        : normalizeHex(params.background_color)
    backgroundPolicy = bgColor === 'none' ? 'original-preserved (requested)' : `custom (${bgColor})`
  } else {
    bgColor = normalizeHex(spec.background || '#ffffff')
    backgroundPolicy = `spec-default (${bgColor})`
  }

  ensureParentDir(outputPath)
  const result = await engine.process({
    inputPath,
    outputPath,
    targetWidth,
    targetHeight,
    bgColorHex: bgColor,
    autoFrame: params.auto_frame ?? true,
    targetHeadRatio: headRatio,
    targetTopMargin: topMargin,
    targetEyeHeight: eyeHeight,
    dpi,
  })

  if (bgColor !== 'none' && !result.backgroundReplaced) {
    backgroundPolicy = `original-preserved (person segmentation failed; ${bgColor} not applied)`
  }
  if (result.message) advisories.push(result.message)

  return {
    ...result,
    specName: spec.name,
    specTitle: spec.title,
    backgroundPolicy,
    targetHeadRatio: Math.round(headRatio * 1000) / 1000,
    advisories,
  }
}
