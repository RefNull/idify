import { runJsonProcess } from './runProcess.js'
import type {
  ComplianceResult,
  ProcessPhotoOptions,
  ProcessPhotoResult,
  RenderSheetOptions,
  RenderSheetResult,
  VisionEngine,
} from './types.js'

function asObject(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`idify-vision ${what} returned an unexpected result`)
  }
  return value as Record<string, unknown>
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

export class AppleVisionEngine implements VisionEngine {
  constructor(readonly binaryPath: string) {}

  async inspect(imagePath: string): Promise<ComplianceResult> {
    const raw = asObject(await runJsonProcess(this.binaryPath, ['inspect', imagePath]), 'inspect')
    const quality = raw.qualityScore
    return {
      ...(raw as unknown as ComplianceResult),
      // Swift omits the key when Vision could not score capture quality.
      qualityScore: typeof quality === 'number' ? quality : null,
      violations: stringList(raw.violations),
      advisories: stringList(raw.advisories),
      engineUsed: 'apple-vision',
    }
  }

  async process(options: ProcessPhotoOptions): Promise<ProcessPhotoResult> {
    const args = [
      'process',
      options.inputPath,
      '--output',
      options.outputPath,
      '--width',
      String(options.targetWidth),
      '--height',
      String(options.targetHeight),
      '--dpi',
      String(options.dpi),
      '--bg',
      options.bgColorHex,
      '--head-ratio',
      String(options.targetHeadRatio),
      '--top-margin',
      String(options.targetTopMargin),
    ]
    if (options.autoFrame) args.push('--auto-frame')

    const raw = asObject(await runJsonProcess(this.binaryPath, args), 'process')
    if (raw.success !== true) {
      throw new Error(`idify-vision process failed: ${String(raw.message ?? 'unknown error')}`)
    }
    return {
      ...(raw as unknown as ProcessPhotoResult),
      backgroundReplaced: raw.backgroundReplaced === true,
      engineUsed: 'apple-vision',
    }
  }

  async renderSheet(options: RenderSheetOptions): Promise<RenderSheetResult> {
    const cells = options.cells
      .map((c) => [c.x, c.y, c.width, c.height].map((n) => String(Math.round(n))).join(','))
      .join(';')
    const args = [
      'sheet',
      options.photoPath,
      '--output',
      options.outputPath,
      '--sheet-width',
      String(options.sheetWidthPx),
      '--sheet-height',
      String(options.sheetHeightPx),
      '--dpi',
      String(options.dpi),
      '--cells',
      cells,
    ]
    if (options.cutGuides) args.push('--cut-guides')

    const raw = asObject(await runJsonProcess(this.binaryPath, args), 'sheet')
    if (raw.success !== true) {
      throw new Error(`idify-vision sheet failed: ${String(raw.message ?? 'unknown error')}`)
    }
    return { ...(raw as unknown as RenderSheetResult), engineUsed: 'apple-vision' }
  }
}
