import { requireVisionEngine } from '../engine/index.js'
import type { ProcessPhotoResult } from '../engine/index.js'
import {
  IMAGE_EXTENSIONS,
  assertImageFile,
  ensureParentDir,
  resolveSafePath,
} from '../pathGuard.js'
import {
  getHeadPlacement,
  getHeadRatioRange,
  getPlacementRules,
  solveCrown,
} from '../../../common/src/utils/placement.js'
import type { PlacementRules } from '../../../common/src/utils/placement.js'
import { findSpec } from '../specs.js'
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

/**
 * Head height and crown position to frame to, from the placement model the
 * web app's guide and auto-framing use. `topMargin` is the crown position for
 * a typical head (the Apple Vision engine frames to it); the onnx engine
 * re-solves it from `rules` with the face's measured eye position.
 */
export function framingTargets(spec: RawSpec): {
  headRatio: number
  topMargin: number
  rules: PlacementRules
  fromSpec: boolean
} {
  const rules = getPlacementRules(spec)
  const headRatio = getHeadRatioRange(rules).target
  return {
    headRatio,
    topMargin: solveCrown(rules, headRatio).crown,
    rules,
    fromSpec: getHeadPlacement(spec) !== null,
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
  const { headRatio, topMargin, rules, fromSpec } = framingTargets(spec)
  if (!fromSpec) {
    advisories.push(`${spec.title} defines no head-size rules; framed to a generic ${Math.round(headRatio * 100)}% head height.`)
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
    placementRules: rules,
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
