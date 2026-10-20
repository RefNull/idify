import type { PlacementRules } from '../../../common/src/utils/placement.js'

/** Which engine produced a result. */
export type EngineName = 'onnx' | 'apple-vision'

export interface ComplianceResult {
  faceDetected: boolean
  faceCount: number
  rollDegrees: number
  /** Null when the engine does not measure it. */
  yawDegrees: number | null
  pitchDegrees: number | null
  /** Face-capture quality (0-1), or null when it was not measured. */
  qualityScore: number | null
  chinYNormalized: number
  crownYNormalized: number
  eyeLevelNormalized: number
  /** Estimated chin-to-crown height as a fraction of the INPUT image height. */
  headHeightRatio: number
  isCentered: boolean
  compliant: boolean
  violations: string[]
  /** Notes that do not make the photo non-compliant on their own. */
  advisories: string[]
  engineUsed: EngineName
}

export interface ProcessPhotoOptions {
  inputPath: string
  outputPath: string
  targetWidth: number
  targetHeight: number
  /** Hex colour, or "none" to keep the original background. */
  bgColorHex: string
  autoFrame: boolean
  targetHeadRatio: number
  targetTopMargin: number
  /**
   * The spec's head-position rules. The onnx engine solves the crown from
   * them with the face's measured eye position; Apple Vision uses
   * targetTopMargin.
   */
  placementRules?: PlacementRules
  dpi: number
}

export interface ProcessPhotoResult {
  success: boolean
  outputPath: string
  width: number
  height: number
  dpi: number
  /** Whether the background was actually replaced (segmentation can fail). */
  backgroundReplaced: boolean
  engineUsed: EngineName
  message?: string | null
}

export interface RenderSheetOptions {
  photoPath: string
  outputPath: string
  sheetWidthPx: number
  sheetHeightPx: number
  dpi: number
  cells: Array<{ x: number; y: number; width: number; height: number }>
  cutGuides: boolean
}

export interface RenderSheetResult {
  success: boolean
  outputPath: string
  width: number
  height: number
  dpi: number
  cellCount: number
  engineUsed: EngineName
  message?: string | null
}

export interface VisionEngine {
  inspect(imagePath: string): Promise<ComplianceResult>
  process(options: ProcessPhotoOptions): Promise<ProcessPhotoResult>
  renderSheet(options: RenderSheetOptions): Promise<RenderSheetResult>
}
