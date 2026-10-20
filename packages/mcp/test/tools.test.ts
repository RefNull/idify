import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  ComplianceResult,
  ProcessPhotoOptions,
  RenderSheetOptions,
  VisionEngine,
} from '../src/engine/index.js'
import { autoCropAndRetouch, createPrintSheet, validatePhotoCompliance } from '../src/tools/index.js'
import { PNG_BYTES, makeRoot, writeFile } from './helpers.js'

/** Records what the tools ask the native engine to do. */
class FakeEngine implements VisionEngine {
  processCalls: ProcessPhotoOptions[] = []
  sheetCalls: RenderSheetOptions[] = []
  inspectCalls: string[] = []
  backgroundReplaced = true

  async inspect(imagePath: string): Promise<ComplianceResult> {
    this.inspectCalls.push(imagePath)
    return {
      faceDetected: true,
      faceCount: 1,
      rollDegrees: 0,
      yawDegrees: 0,
      pitchDegrees: 0,
      qualityScore: null,
      chinYNormalized: 0.85,
      crownYNormalized: 0.1,
      eyeLevelNormalized: 0.45,
      headHeightRatio: 0.75,
      isCentered: true,
      compliant: true,
      violations: [],
      advisories: ['Capture quality could not be measured; it was not checked'],
      engineUsed: 'apple-vision',
    }
  }

  async process(options: ProcessPhotoOptions) {
    this.processCalls.push(options)
    fs.writeFileSync(options.outputPath, PNG_BYTES)
    return {
      success: true,
      outputPath: options.outputPath,
      width: options.targetWidth,
      height: options.targetHeight,
      dpi: options.dpi,
      backgroundReplaced: options.bgColorHex !== 'none' && this.backgroundReplaced,
      engineUsed: 'apple-vision' as const,
    }
  }

  async renderSheet(options: RenderSheetOptions) {
    this.sheetCalls.push(options)
    fs.writeFileSync(options.outputPath, PNG_BYTES)
    return {
      success: true,
      outputPath: options.outputPath,
      width: options.sheetWidthPx,
      height: options.sheetHeightPx,
      dpi: options.dpi,
      cellCount: options.cells.length,
      engineUsed: 'apple-vision' as const,
    }
  }
}

let root: string
let engine: FakeEngine
const savedRoot = process.env.IDIFY_MCP_ROOT

beforeEach(() => {
  root = makeRoot()
  process.env.IDIFY_MCP_ROOT = root
  engine = new FakeEngine()
  writeFile(root, 'in/photo.png', PNG_BYTES)
})
afterEach(() => {
  if (savedRoot === undefined) delete process.env.IDIFY_MCP_ROOT
  else process.env.IDIFY_MCP_ROOT = savedRoot
  fs.rmSync(root, { recursive: true, force: true })
})

describe('validate_photo_compliance', () => {
  it('passes the confined real path to the engine and keeps null quality', async () => {
    const result = await validatePhotoCompliance(
      { image_path: 'in/photo.png', spec_name: 'australia_passport' },
      { engine }
    )
    expect(engine.inspectCalls).toEqual([path.join(root, 'in/photo.png')])
    expect(result.qualityScore).toBeNull()
    expect(result.compliant).toBe(true)
    expect(result.advisories.join('\n')).toMatch(/prohibit digital background/)
  })

  it('rejects a non-image before running the engine', async () => {
    writeFile(root, 'fake.png', 'not an image')
    await expect(validatePhotoCompliance({ image_path: 'fake.png' }, { engine })).rejects.toThrow(
      /not a PNG or JPEG/
    )
    expect(engine.inspectCalls).toEqual([])
  })
})

describe('auto_crop_and_retouch', () => {
  const base = { input_path: 'in/photo.png', output_path: 'out/a.png' }

  it('uses spec head bounds, spec background and keeps physical size', async () => {
    const result = await autoCropAndRetouch(
      { ...base, spec_name: 'united_states_passport', dpi: 300 },
      { engine }
    )
    const call = engine.processCalls[0]
    expect(call.outputPath).toBe(path.join(root, 'out/a.png'))
    expect(call.bgColorHex).toMatch(/^#[0-9a-f]{6}$/)
    expect(call.dpi).toBe(300)
    // 2x2 inch at 300 dpi
    expect(call.targetWidth).toBe(600)
    expect(call.targetHeight).toBe(600)
    expect(result.backgroundPolicy).toMatch(/spec-default/)
  })

  it('never replaces the background when the spec prohibits it', async () => {
    const result = await autoCropAndRetouch(
      { ...base, spec_name: 'australia_passport', background_color: '#00FF00' },
      { engine }
    )
    expect(engine.processCalls[0].bgColorHex).toBe('none')
    expect(result.advisories.join('\n')).toMatch(/background_color was ignored/)
  })

  it('normalises custom colours and reports segmentation failure honestly', async () => {
    engine.backgroundReplaced = false
    const result = await autoCropAndRetouch(
      { ...base, spec_name: 'united_states_passport', background_color: 'FFFFFF' },
      { engine }
    )
    expect(engine.processCalls[0].bgColorHex).toBe('#ffffff')
    expect(result.backgroundPolicy).toMatch(/segmentation failed/)
  })

  it('rejects an invalid colour', async () => {
    await expect(
      autoCropAndRetouch(
        { ...base, spec_name: 'united_states_passport', background_color: 'red' },
        { engine }
      )
    ).rejects.toThrow(/Invalid colour/)
  })

  it('refuses to overwrite, and to write into the input file', async () => {
    writeFile(root, 'out/a.png', PNG_BYTES)
    await expect(
      autoCropAndRetouch({ ...base, spec_name: 'united_states_passport' }, { engine })
    ).rejects.toThrow(/already exists/)
    await expect(
      autoCropAndRetouch(
        { ...base, output_path: 'in/photo.png', spec_name: 'united_states_passport', overwrite: true },
        { engine }
      )
    ).rejects.toThrow(/must differ/)
    expect(engine.processCalls).toEqual([])
  })

  it('rejects an output outside the root', async () => {
    await expect(
      autoCropAndRetouch(
        { ...base, output_path: '../escape.png', spec_name: 'united_states_passport' },
        { engine }
      )
    ).rejects.toThrow(/outside the allowed root/)
  })
})

describe('create_print_sheet', () => {
  it('renders through the engine with the common layout and writes a manifest of geometry only', async () => {
    const result = await createPrintSheet(
      {
        photo_path: 'in/photo.png',
        output_path: 'sheets/sheet.png',
        spec_name: 'united_states_passport',
        manifest_path: 'sheets/sheet.json',
      },
      { engine }
    )
    const call = engine.sheetCalls[0]
    expect(call.dpi).toBe(300)
    expect(call.cells).toHaveLength(result.layout.photosPerSheet)
    expect(call.cutGuides).toBe(true)
    expect(result.layout.sheetWidthPx * result.layout.sheetHeightPx).toBe(1200 * 1800)

    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'sheets/sheet.json'), 'utf8'))
    expect(manifest).toEqual(JSON.parse(JSON.stringify(result.layout)))
    expect(JSON.stringify(manifest)).not.toContain('photo.png')
  })

  it('requires a .png sheet and a .json manifest', async () => {
    const args = { photo_path: 'in/photo.png', spec_name: 'united_states_passport' }
    await expect(createPrintSheet({ ...args, output_path: 'sheet.json' }, { engine })).rejects.toThrow(
      /extensions: \.png/
    )
    await expect(
      createPrintSheet({ ...args, output_path: 's.png', manifest_path: 'x.sh' }, { engine })
    ).rejects.toThrow(/extensions: \.json/)
    expect(engine.sheetCalls).toEqual([])
  })

  it('refuses an existing manifest without overwrite', async () => {
    writeFile(root, 'm.json', '{}')
    await expect(
      createPrintSheet(
        {
          photo_path: 'in/photo.png',
          output_path: 's.png',
          spec_name: 'united_states_passport',
          manifest_path: 'm.json',
        },
        { engine }
      )
    ).rejects.toThrow(/already exists/)
  })
})
