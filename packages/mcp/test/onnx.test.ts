import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OnnxEngine } from '../src/engine/index.js'
import { autoCropAndRetouch, createPrintSheet, validatePhotoCompliance } from '../src/tools/index.js'
import { makeRoot } from './helpers.js'

// The real cross-platform engine on a demo photo from the web app.
const demo = fileURLToPath(new URL('../../common/src/assets/demos/demo-2.jpg', import.meta.url))
const deps = { engine: new OnnxEngine() }

let root: string
const savedRoot = process.env.IDIFY_MCP_ROOT

beforeAll(() => {
  root = makeRoot()
  process.env.IDIFY_MCP_ROOT = root
  fs.copyFileSync(demo, path.join(root, 'photo.jpg'))
})
afterAll(() => {
  if (savedRoot === undefined) delete process.env.IDIFY_MCP_ROOT
  else process.env.IDIFY_MCP_ROOT = savedRoot
  fs.rmSync(root, { recursive: true, force: true })
})

describe('onnx engine', { timeout: 180000 }, () => {
  it('finds one upright, centred face and leaves unmeasured values null', async () => {
    const report = await validatePhotoCompliance({ image_path: 'photo.jpg' }, deps)
    expect(report.engineUsed).toBe('onnx')
    expect(report.faceCount).toBe(1)
    expect(Math.abs(report.rollDegrees)).toBeLessThan(3)
    expect(report.pitchDegrees).toBeNull()
    expect(report.qualityScore).toBeNull()
    expect(report.isCentered).toBe(true)
  })

  it('frames a US passport photo inside the head and eye bands', async () => {
    const result = await autoCropAndRetouch(
      { input_path: 'photo.jpg', output_path: 'us.png', spec_name: 'united_states_passport' },
      deps
    )
    expect(result.backgroundReplaced).toBe(true)
    const meta = await sharp(path.join(root, 'us.png')).metadata()
    expect([meta.width, meta.height, meta.density]).toEqual([1200, 1200, 600])

    const report = await validatePhotoCompliance(
      { image_path: 'us.png', spec_name: 'united_states_passport' },
      deps
    )
    expect(report.violations).toEqual([])
    // Eye line between 56% and 69% of the height, measured from the bottom.
    const eyeFromBottom = 1 - report.eyeLevelNormalized
    expect(eyeFromBottom).toBeGreaterThan(0.56)
    expect(eyeFromBottom).toBeLessThan(0.69)

    // The new background is plain white in the top corners.
    const { data } = await sharp(path.join(root, 'us.png'))
      .extract({ left: 0, top: 0, width: 20, height: 20 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect(Math.min(...data)).toBeGreaterThan(250)
  })

  it('keeps the original background when the spec prohibits replacing it', async () => {
    const result = await autoCropAndRetouch(
      { input_path: 'photo.jpg', output_path: 'uk.jpg', spec_name: 'united_kingdom_passport' },
      deps
    )
    expect(result.backgroundReplaced).toBe(false)
    const report = await validatePhotoCompliance(
      { image_path: 'uk.jpg', spec_name: 'united_kingdom_passport' },
      deps
    )
    expect(report.violations).toEqual([])
  })

  it('renders a print sheet with DPI metadata', async () => {
    const result = await createPrintSheet(
      { photo_path: 'us.png', output_path: 'sheet.png', spec_name: 'united_states_passport', cut_guides: true },
      deps
    )
    const meta = await sharp(path.join(root, 'sheet.png')).metadata()
    expect([meta.width, meta.height, meta.density]).toEqual([
      result.layout.sheetWidthPx,
      result.layout.sheetHeightPx,
      result.layout.dpi,
    ])
    // A grey hairline just outside the first cell.
    const cell = result.layout.cells[0]
    const { data } = await sharp(path.join(root, 'sheet.png'))
      .extract({ left: cell.x + 10, top: cell.y - 1, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    expect([...data]).toEqual([153, 153, 153])
  })
})
