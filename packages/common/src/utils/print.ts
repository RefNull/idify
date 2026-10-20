import { RetouchAdjustment, RetouchBackground } from '../stores'
import {
  DEFAULT_SHEET_DPI,
  DEFAULT_SHEET_SIZE_INCH,
  IDPhotoDimension,
  PlanPrintSheetOptions,
  planPrintSheet,
  printSheetCells,
  PrintSheetLayout,
  PrintSheetPlan,
  PrintSheetCell,
} from './pure'
import { renderIDPhotoCanvas } from './image'
import { withPngDensity } from './png'

export {
  DEFAULT_SHEET_DPI,
  DEFAULT_SHEET_SIZE_INCH,
  planPrintSheet,
  printSheetCells,
}
export type {
  IDPhotoDimension,
  PlanPrintSheetOptions,
  PrintSheetLayout,
  PrintSheetPlan,
  PrintSheetCell,
}

export interface CreatePrintSheetOptions {
  image: string
  background: RetouchBackground
  adjustment: RetouchAdjustment
  dimension: IDPhotoDimension
  sheetSizeInch?: { width: number; height: number }
  dpi?: number
  marginMm?: number
  gutterMm?: number
  cutGuides?: boolean
  sheetColor?: string
}

export interface PrintSheet {
  blob: Blob
  layout: PrintSheetLayout
}

/**
 * Tile a finished ID photo across a print sheet (4x6 inches by default),
 * repeated as many times as fit, with cut guides and a true-size DPI tag.
 */
export async function createPrintSheet({
  image,
  background,
  adjustment,
  dimension,
  sheetSizeInch = DEFAULT_SHEET_SIZE_INCH,
  dpi = DEFAULT_SHEET_DPI,
  marginMm = 3,
  gutterMm = 2,
  cutGuides = true,
  sheetColor = '#ffffff',
}: CreatePrintSheetOptions): Promise<PrintSheet | null> {
  const plan = planPrintSheet({
    dimension,
    sheetSizeInch,
    dpi,
    marginMm,
    gutterMm,
  })
  if (!plan) {
    return null
  }
  const { photoW, photoH } = plan

  // Render the photo once at no less than its authored resolution, then let the
  // sheet downscale it, so tiling never softens the image.
  const renderScale = Math.max(1, dimension.width / photoW)
  const photoCanvas = await renderIDPhotoCanvas({
    image,
    background,
    adjustment,
    resolution: {
      width: Math.round(photoW * renderScale),
      height: Math.round(photoH * renderScale),
    },
  })
  if (!photoCanvas) {
    return null
  }

  const sheet = document.createElement('canvas')
  sheet.width = plan.sheetWidthPx
  sheet.height = plan.sheetHeightPx
  const ctx = sheet.getContext('2d')
  if (!ctx) {
    return null
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.fillStyle = sheetColor
  ctx.fillRect(0, 0, sheet.width, sheet.height)

  const guideWidth = Math.max(1, Math.round(dpi / 300))
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)'
  ctx.lineWidth = guideWidth

  printSheetCells(plan).forEach(({ x, y, width, height }) => {
    ctx.drawImage(photoCanvas, x, y, width, height)
    if (cutGuides) {
      ctx.strokeRect(
        x - guideWidth * 1.5,
        y - guideWidth * 1.5,
        width + guideWidth * 3,
        height + guideWidth * 3
      )
    }
  })

  const blob = await new Promise<Blob>((resolve, reject) => {
    sheet.toBlob((file) => {
      if (file) {
        resolve(file)
      } else {
        reject(new Error('failed'))
      }
    }, 'image/png')
  })

  return {
    blob: await withPngDensity(blob, dpi),
    layout: {
      columns: plan.columns,
      rows: plan.rows,
      count: plan.count,
      orientation: plan.orientation,
      sheetWidthPx: plan.sheetWidthPx,
      sheetHeightPx: plan.sheetHeightPx,
      dpi: plan.dpi,
    },
  }
}

export default createPrintSheet
