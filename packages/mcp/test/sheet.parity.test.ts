import { describe, expect, it } from 'vitest'
// The reference implementation the web app uses.
import * as common from '../../common/src/utils/pure.ts'
import { DEFAULT_SHEET_DPI, planPrintSheet, printSheetCells } from '../src/sheet.js'
import { loadAllSpecs } from '../src/specs.js'
import { computeSheetLayout } from '../src/tools/createPrintSheet.js'

describe('print sheet maths matches @idify/common', () => {
  it('uses the same defaults', () => {
    expect(DEFAULT_SHEET_DPI).toBe(common.DEFAULT_SHEET_DPI)
  })

  it.each([150, 300, 600, 1200])('plans and cells are identical for every spec at %i dpi', (dpi) => {
    for (const spec of loadAllSpecs()) {
      const mine = planPrintSheet({ dimension: spec.dimension, dpi })
      const theirs = common.planPrintSheet({
        dimension: spec.dimension as common.IDPhotoDimension,
        dpi,
      })
      expect(mine, spec.name).toEqual(theirs)
      if (mine && theirs) {
        expect(printSheetCells(mine), spec.name).toEqual(common.printSheetCells(theirs))
      }
    }
  })

  it('agrees on edge cases (too large, zero size, custom margins)', () => {
    const cases = [
      { dimension: { dpi: 300, width: 3000, height: 3000, unit: 'mm' as const } },
      { dimension: { dpi: 300, width: 0, height: 100, unit: 'mm' as const } },
      { dimension: { dpi: 300, width: 413, height: 531, unit: 'mm' as const }, marginMm: 0, gutterMm: 0 },
      { dimension: { dpi: 300, width: 413, height: 531, unit: 'mm' as const }, sheetSizeInch: { width: 5, height: 7 } },
    ]
    for (const options of cases) {
      expect(planPrintSheet(options)).toEqual(common.planPrintSheet(options))
    }
  })
})

describe('computeSheetLayout', () => {
  it('returns cells with 1-based row/column and default 300 dpi', () => {
    const us = loadAllSpecs().find((s) => s.name === 'united_states_passport')!
    const layout = computeSheetLayout(us)
    expect(layout.dpi).toBe(300)
    expect(layout.cells).toHaveLength(layout.photosPerSheet)
    expect(layout.cells[0]).toMatchObject({ col: 1, row: 1 })
    const last = layout.cells[layout.cells.length - 1]
    expect(last).toMatchObject({ col: layout.columns, row: layout.rows })
    for (const c of layout.cells) {
      expect(c.x).toBeGreaterThanOrEqual(layout.marginPx)
      expect(c.x + c.width).toBeLessThanOrEqual(layout.sheetWidthPx - layout.marginPx)
    }
  })

  it('errors when nothing fits instead of reporting one photo', () => {
    const huge = { ...loadAllSpecs()[0], dimension: { dpi: 100, width: 1000, height: 1000, unit: 'inch' } }
    expect(() => computeSheetLayout(huge)).toThrow(/do not fit/)
  })
})
