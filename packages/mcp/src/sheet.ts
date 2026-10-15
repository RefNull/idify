/**
 * Print-sheet geometry.
 *
 * This is a verbatim port of planPrintSheet / printSheetCells from
 * packages/common/src/utils/pure.ts. It is copied rather than imported because
 * @idify/common ships TypeScript sources only, while this package must compile
 * with plain tsc (rootDir ./src) and run from dist with no build of common.
 * test/sheet.parity.test.ts imports the common implementation and asserts both
 * produce identical output for every spec, so any drift fails the tests.
 */

export const MM_PER_INCH = 25.4

export const DEFAULT_SHEET_SIZE_INCH = { width: 4, height: 6 }

export const DEFAULT_SHEET_DPI = 300

export interface PhotoDimension {
  dpi: number
  width: number
  height: number
  unit?: string
}

export interface PrintSheetLayout {
  columns: number
  rows: number
  count: number
  orientation: 'portrait' | 'landscape'
  sheetWidthPx: number
  sheetHeightPx: number
  dpi: number
}

export interface PlanPrintSheetOptions {
  dimension: PhotoDimension
  sheetSizeInch?: { width: number; height: number }
  dpi?: number
  marginMm?: number
  gutterMm?: number
}

export interface PrintSheetPlan extends PrintSheetLayout {
  photoW: number
  photoH: number
  margin: number
  gutter: number
}

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

/** Returns null when not even one photo fits on the sheet. */
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
