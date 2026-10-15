import { describe, expect, it } from 'vitest'
import { IDPhotoSpec } from '../types'
import {
  MM_PER_INCH,
  getHeadGuideMetrics,
  planPrintSheet,
  printSheetCells,
} from './pure'

const mm = (value: number, dpi = 300) => Math.round((value / MM_PER_INCH) * dpi)

describe('planPrintSheet', () => {
  it('tiles a 35x45 mm passport photo onto a 4x6 sheet', () => {
    const plan = planPrintSheet({
      dimension: { width: mm(35), height: mm(45), dpi: 300, unit: 'mm' },
    })!
    expect(plan).not.toBeNull()
    expect(plan.dpi).toBe(300)
    expect(plan.photoW).toBe(mm(35))
    expect(plan.photoH).toBe(mm(45))
    // 4x6 in = 101.6 x 152.4 mm: 2 x 3 portrait or 4 x 2 landscape.
    expect(plan.count).toBe(8)
    expect(plan.orientation).toBe('landscape')
    expect(plan.sheetWidthPx).toBe(1800)
    expect(plan.sheetHeightPx).toBe(1200)
    expect(plan.columns * plan.rows).toBe(plan.count)
  })

  it('converts the photo size via its own dpi', () => {
    const a = planPrintSheet({
      dimension: { width: 413, height: 531, dpi: 300, unit: 'mm' },
    })!
    const b = planPrintSheet({
      dimension: { width: 826, height: 1062, dpi: 600, unit: 'mm' },
    })!
    expect(b.photoW).toBe(a.photoW)
    expect(b.count).toBe(a.count)
  })

  it('returns null when nothing fits or the size is invalid', () => {
    expect(
      planPrintSheet({
        dimension: { width: 3000, height: 3000, dpi: 300, unit: 'inch' },
      })
    ).toBeNull()
    expect(
      planPrintSheet({
        dimension: { width: 0, height: 10, dpi: 300, unit: 'mm' },
      })
    ).toBeNull()
    expect(
      planPrintSheet({
        dimension: { width: 10, height: 10, dpi: 0, unit: 'mm' },
      })
    ).toBeNull()
  })

  it('honours custom sheet, dpi, margin and gutter', () => {
    const plan = planPrintSheet({
      dimension: { width: 600, height: 600, dpi: 300, unit: 'inch' },
      sheetSizeInch: { width: 5, height: 7 },
      dpi: 600,
      marginMm: 0,
      gutterMm: 0,
    })!
    expect(plan.photoW).toBe(1200)
    expect(plan.margin).toBe(0)
    expect(plan.gutter).toBe(0)
    expect(plan.count).toBe(6) // 2 x 3 whole 2-inch squares on 5 x 7
  })
})

describe('printSheetCells', () => {
  it('returns one cell per photo, centred, inside the margins, without overlap', () => {
    const plan = planPrintSheet({
      dimension: { width: mm(35), height: mm(45), dpi: 300, unit: 'mm' },
    })!
    const cells = printSheetCells(plan)
    expect(cells).toHaveLength(plan.count)
    for (const cell of cells) {
      expect(cell.width).toBe(plan.photoW)
      expect(cell.height).toBe(plan.photoH)
      expect(cell.x).toBeGreaterThanOrEqual(plan.margin)
      expect(cell.y).toBeGreaterThanOrEqual(plan.margin)
      expect(cell.x + cell.width).toBeLessThanOrEqual(
        plan.sheetWidthPx - plan.margin
      )
      expect(cell.y + cell.height).toBeLessThanOrEqual(
        plan.sheetHeightPx - plan.margin
      )
    }
    // Neighbours are a gutter apart.
    expect(cells[1].x - cells[0].x).toBe(plan.photoW + plan.gutter)
    // Centred: equal space left and right (to within rounding).
    const left = cells[0].x
    const right = plan.sheetWidthPx - (cells[plan.columns - 1].x + plan.photoW)
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1)
  })
})

describe('getHeadGuideMetrics', () => {
  const base: IDPhotoSpec = {
    name: 'test',
    type: 'passport',
    title: 'Test',
    region: 'Test',
    zone: 'TT',
    flag: '',
    dimension: { width: 600, height: 600, dpi: 300, unit: 'inch' },
    background: '#ffffff',
  }

  it('is null without head rules', () => {
    expect(getHeadGuideMetrics(base)).toBeNull()
    expect(getHeadGuideMetrics({ ...base, rules: { size: 240 } })).toBeNull()
  })

  it('converts fractions of the photo height to mm', () => {
    const metrics = getHeadGuideMetrics({
      ...base,
      rules: { minHeadHeight: 0.5, maxHeadHeight: 0.69, minHeadOffset: 0.1 },
    })!
    expect(metrics.photoHeightMm).toBeCloseTo(50.8)
    expect(metrics.minHeadMm).toBeCloseTo(25.4)
    expect(metrics.maxHeadMm).toBeCloseTo(0.69 * 50.8)
    expect(metrics.crownOffsetMm).toBeCloseTo(5.08)
    expect(metrics.minHead).toBe(0.5)
    expect(metrics.crownOffset).toBe(0.1)
  })

  it('reports an unbounded maximum as 0', () => {
    const metrics = getHeadGuideMetrics({
      ...base,
      rules: { minHeadHeight: 0.5 },
    })!
    expect(metrics.maxHeadMm).toBe(0)
    expect(metrics.crownOffsetMm).toBe(0)
  })
})
