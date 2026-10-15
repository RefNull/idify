import fs from 'node:fs'
import { requireVisionEngine } from '../engine/index.js'
import {
  IMAGE_EXTENSIONS,
  MANIFEST_EXTENSIONS,
  PNG_EXTENSIONS,
  assertImageFile,
  ensureParentDir,
  resolveSafePath,
} from '../pathGuard.js'
import {
  DEFAULT_SHEET_DPI,
  DEFAULT_SHEET_SIZE_INCH,
  MM_PER_INCH,
  planPrintSheet,
  printSheetCells,
} from '../sheet.js'
import type { PrintSheetCell, PrintSheetPlan } from '../sheet.js'
import { findSpec, specSizeMm } from '../specs.js'
import type { RawSpec } from '../specs.js'
import type { ToolDeps } from './shared.js'

export interface CreatePrintSheetParams {
  photo_path: string
  output_path: string
  spec_name: string
  sheet_dpi?: number
  cut_guides?: boolean
  manifest_path?: string
  overwrite?: boolean
}

export interface SheetLayout {
  spec: string
  specTitle: string
  photoSizeMm: { width: number; height: number }
  sheetSizeInch: { width: number; height: number }
  sheetDimensionsMm: { width: number; height: number }
  orientation: 'portrait' | 'landscape'
  dpi: number
  sheetWidthPx: number
  sheetHeightPx: number
  columns: number
  rows: number
  photosPerSheet: number
  photoWidthPx: number
  photoHeightPx: number
  marginPx: number
  gutterPx: number
  cutGuides: boolean
  cells: Array<PrintSheetCell & { col: number; row: number }>
}

export interface CreatePrintSheetResult {
  success: boolean
  outputPath: string
  manifestPath: string | null
  engineUsed: string
  layout: SheetLayout
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Compute the sheet layout for a spec; throws when no photo fits. */
export function computeSheetLayout(
  spec: RawSpec,
  dpi = DEFAULT_SHEET_DPI,
  cutGuides = true
): SheetLayout {
  const plan: PrintSheetPlan | null = planPrintSheet({ dimension: spec.dimension, dpi })
  if (!plan) {
    throw new Error(
      `${spec.title} photos do not fit on a ${DEFAULT_SHEET_SIZE_INCH.width}x${DEFAULT_SHEET_SIZE_INCH.height} inch sheet with 3 mm margins`
    )
  }
  const { widthMm, heightMm } = specSizeMm(spec)
  const cells = printSheetCells(plan).map((cell, i) => ({
    col: (i % plan.columns) + 1,
    row: Math.floor(i / plan.columns) + 1,
    ...cell,
  }))
  return {
    spec: spec.name,
    specTitle: spec.title,
    photoSizeMm: { width: round1(widthMm), height: round1(heightMm) },
    sheetSizeInch: { ...DEFAULT_SHEET_SIZE_INCH },
    sheetDimensionsMm: {
      width: round1((plan.sheetWidthPx / plan.dpi) * MM_PER_INCH),
      height: round1((plan.sheetHeightPx / plan.dpi) * MM_PER_INCH),
    },
    orientation: plan.orientation,
    dpi: plan.dpi,
    sheetWidthPx: plan.sheetWidthPx,
    sheetHeightPx: plan.sheetHeightPx,
    columns: plan.columns,
    rows: plan.rows,
    photosPerSheet: plan.count,
    photoWidthPx: plan.photoW,
    photoHeightPx: plan.photoH,
    marginPx: plan.margin,
    gutterPx: plan.gutter,
    cutGuides,
    cells,
  }
}

export async function createPrintSheet(
  params: CreatePrintSheetParams,
  deps: ToolDeps = {}
): Promise<CreatePrintSheetResult> {
  const engine = deps.engine ?? requireVisionEngine(deps.capabilities)
  const spec = findSpec(params.spec_name)
  const overwrite = params.overwrite === true

  const photoPath = resolveSafePath(params.photo_path, {
    label: 'photo_path',
    mode: 'read',
    extensions: IMAGE_EXTENSIONS,
  })
  assertImageFile(photoPath, 'photo_path')
  const outputPath = resolveSafePath(params.output_path, {
    label: 'output_path',
    mode: 'write',
    extensions: PNG_EXTENSIONS,
    overwrite,
  })
  const manifestPath = params.manifest_path
    ? resolveSafePath(params.manifest_path, {
        label: 'manifest_path',
        mode: 'write',
        extensions: MANIFEST_EXTENSIONS,
        overwrite,
      })
    : null
  if (outputPath === photoPath || manifestPath === photoPath || manifestPath === outputPath) {
    throw new Error('photo_path, output_path and manifest_path must all be different files')
  }

  const layout = computeSheetLayout(spec, params.sheet_dpi ?? DEFAULT_SHEET_DPI, params.cut_guides ?? true)

  ensureParentDir(outputPath)
  const rendered = await engine.renderSheet({
    photoPath,
    outputPath,
    sheetWidthPx: layout.sheetWidthPx,
    sheetHeightPx: layout.sheetHeightPx,
    dpi: layout.dpi,
    cells: layout.cells,
    cutGuides: layout.cutGuides,
  })

  if (manifestPath) {
    ensureParentDir(manifestPath)
    // Only computed geometry goes in the manifest, never caller-supplied text.
    fs.writeFileSync(manifestPath, JSON.stringify(layout, null, 2) + '\n', {
      flag: overwrite ? 'w' : 'wx',
    })
  }

  return {
    success: true,
    outputPath: rendered.outputPath,
    manifestPath,
    engineUsed: rendered.engineUsed,
    layout,
  }
}
