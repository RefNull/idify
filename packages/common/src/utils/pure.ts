import { IDPhotoSpec } from '../types'

export const MM_PER_INCH = 25.4

export const DEFAULT_SHEET_SIZE_INCH = { width: 4, height: 6 }

export const DEFAULT_SHEET_DPI = 300

export type IDPhotoDimension = IDPhotoSpec['dimension']

export interface HeadGuideMetrics {
  /** Photo height in millimetres. */
  photoHeightMm: number
  /** Smallest permitted chin-to-crown height, in mm. */
  minHeadMm: number
  /** Largest permitted chin-to-crown height, in mm, or 0 when unbounded. */
  maxHeadMm: number
  /** Required clear space above the crown, in mm. */
  crownOffsetMm: number
  /** The same values as fractions of the photo height. */
  minHead: number
  maxHead: number
  crownOffset: number
}

/**
 * Resolve a spec's head-position rules into millimetres. Rules are stored as
 * fractions of the photo height; physical size is pixels over the dpi they
 * were authored at.
 */
export function getHeadGuideMetrics(spec: IDPhotoSpec): HeadGuideMetrics | null {
  const rules = spec.rules
  if (!rules) {
    return null
  }
  const { minHeadHeight = 0, maxHeadHeight = 0, minHeadOffset = 0 } = rules
  if (minHeadHeight <= 0 && maxHeadHeight <= 0) {
    return null
  }
  const photoHeightMm =
    (spec.dimension.height / spec.dimension.dpi) * MM_PER_INCH
  return {
    photoHeightMm,
    minHeadMm: minHeadHeight * photoHeightMm,
    maxHeadMm: maxHeadHeight * photoHeightMm,
    crownOffsetMm: minHeadOffset * photoHeightMm,
    minHead: minHeadHeight,
    maxHead: maxHeadHeight,
    crownOffset: minHeadOffset,
  }
}

export interface PrintSheetLayout {
  columns: number
  rows: number
  /** How many photos fit on the sheet. */
  count: number
  /** Which way round the sheet is, to fit the most photos. */
  orientation: 'portrait' | 'landscape'
  sheetWidthPx: number
  sheetHeightPx: number
  dpi: number
}

export interface PlanPrintSheetOptions {
  dimension: IDPhotoDimension
  sheetSizeInch?: { width: number; height: number }
  dpi?: number
  marginMm?: number
  gutterMm?: number
}

export interface PrintSheetPlan extends PrintSheetLayout {
  /** Pixel size of one photo on the sheet. */
  photoW: number
  photoH: number
  margin: number
  gutter: number
}

/** How many `photoW x photoH` cells tile into the printable area. */
function fitGrid(
  sheetW: number,
  sheetH: number,
  photoW: number,
  photoH: number,
  margin: number,
  gutter: number
) {
  const usableW = sheetW - margin * 2
  const usableH = sheetH - margin * 2
  if (photoW <= 0 || photoH <= 0 || usableW < photoW || usableH < photoH) {
    return { columns: 0, rows: 0, count: 0 }
  }
  const columns = Math.floor((usableW + gutter) / (photoW + gutter))
  const rows = Math.floor((usableH + gutter) / (photoH + gutter))
  return { columns, rows, count: columns * rows }
}

/**
 * Work out how to tile a photo across the sheet: which way round to turn the
 * paper, and how many photos fit. Pure arithmetic, zero DOM dependencies.
 */
export function planPrintSheet({
  dimension,
  sheetSizeInch = DEFAULT_SHEET_SIZE_INCH,
  dpi = DEFAULT_SHEET_DPI,
  marginMm = 3,
  gutterMm = 2,
}: PlanPrintSheetOptions): PrintSheetPlan | null {
  const photoWidthInch = dimension.width / dimension.dpi
  const photoHeightInch = dimension.height / dimension.dpi
  if (!(photoWidthInch > 0) || !(photoHeightInch > 0)) {
    return null
  }

  const photoW = Math.round(photoWidthInch * dpi)
  const photoH = Math.round(photoHeightInch * dpi)
  const margin = Math.round((marginMm / MM_PER_INCH) * dpi)
  const gutter = Math.round((gutterMm / MM_PER_INCH) * dpi)
  const shortEdge = Math.round(sheetSizeInch.width * dpi)
  const longEdge = Math.round(sheetSizeInch.height * dpi)

  const candidates = (
    [
      ['portrait', shortEdge, longEdge],
      ['landscape', longEdge, shortEdge],
    ] as const
  ).map(([orientation, sheetW, sheetH]) => ({
    orientation,
    sheetW,
    sheetH,
    ...fitGrid(sheetW, sheetH, photoW, photoH, margin, gutter),
  }))

  const best = candidates.reduce((acc, candidate) =>
    candidate.count > acc.count ? candidate : acc
  )

  if (best.count < 1) {
    return null
  }

  return {
    columns: best.columns,
    rows: best.rows,
    count: best.count,
    orientation: best.orientation,
    sheetWidthPx: best.sheetW,
    sheetHeightPx: best.sheetH,
    dpi,
    photoW,
    photoH,
    margin,
    gutter,
  }
}

export interface PrintSheetCell {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Where each photo sits on the sheet, as a block centred in the printable
 * area. Pure arithmetic, zero DOM dependencies.
 */
export function printSheetCells(plan: PrintSheetPlan): PrintSheetCell[] {
  const { columns, rows, photoW, photoH, gutter } = plan
  const gridW = columns * photoW + (columns - 1) * gutter
  const gridH = rows * photoH + (rows - 1) * gutter
  const originX = Math.round((plan.sheetWidthPx - gridW) / 2)
  const originY = Math.round((plan.sheetHeightPx - gridH) / 2)
  const cells: PrintSheetCell[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push({
        x: originX + column * (photoW + gutter),
        y: originY + row * (photoH + gutter),
        width: photoW,
        height: photoH,
      })
    }
  }
  return cells
}
