import { describe, expect, it } from 'vitest'
import {
  NoVisionEngineError,
  OnnxEngine,
  detectPlatformCapabilities,
  requireVisionEngine,
  runJsonProcess,
} from '../src/engine/index.js'
import { autoCropAndRetouch, createPrintSheet, validatePhotoCompliance } from '../src/tools/index.js'

const node = process.execPath
const script = (code: string) => ['-e', code]

describe('detectPlatformCapabilities', () => {
  it('uses apple-vision only on darwin/arm64 with the binary present', () => {
    const caps = detectPlatformCapabilities({
      platform: 'darwin',
      arch: 'arm64',
      binaryPath: '/x/idify-vision',
      binaryExists: () => true,
      preference: '',
    })
    expect(caps.engine).toBe('apple-vision')
    expect(caps.nativeBinaryPath).toBe('/x/idify-vision')
    expect(caps.unavailableReason).toBeNull()
    expect(caps.visionTools).toContain('validate_photo_compliance')
  })

  it('prefers onnx when IDIFY_MCP_ENGINE=onnx, even with the binary', () => {
    const caps = detectPlatformCapabilities({
      platform: 'darwin',
      arch: 'arm64',
      binaryExists: () => true,
      preference: 'onnx',
    })
    expect(caps.engine).toBe('onnx')
    expect(caps.hasNativeBinary).toBe(true)
  })

  it.each([
    ['darwin', 'arm64', false],
    ['darwin', 'x64', true],
    ['linux', 'arm64', true],
    ['win32', 'x64', true],
  ] as const)('uses onnx on %s/%s (binary present: %s)', (platform, arch, exists) => {
    const caps = detectPlatformCapabilities({ platform, arch, binaryExists: () => exists, preference: '' })
    expect(caps.engine).toBe('onnx')
    expect(caps.nativeBinaryPath).toBeNull()
    expect(caps.unavailableReason).toBeNull()
    expect(caps.visionTools).toContain('auto_crop_and_retouch')
    expect(requireVisionEngine(caps)).toBeInstanceOf(OnnxEngine)
  })

  it('reports no engine when apple-vision is insisted on but missing', () => {
    const caps = detectPlatformCapabilities({
      platform: 'linux',
      arch: 'x64',
      preference: 'apple-vision',
    })
    expect(caps.engine).toBe('none')
    expect(caps.visionTools).toEqual([])
    expect(caps.unavailableReason).toMatch(/IDIFY_MCP_ENGINE=apple-vision.+linux\/x64/)
    expect(() => requireVisionEngine(caps)).toThrow(NoVisionEngineError)
  })
})

describe('vision tools without an engine', () => {
  const capabilities = detectPlatformCapabilities({
    platform: 'linux',
    arch: 'x64',
    preference: 'apple-vision',
  })
  const deps = { capabilities }

  it('validate_photo_compliance fails instead of inventing results', async () => {
    await expect(validatePhotoCompliance({ image_path: 'a.png' }, deps)).rejects.toThrow(
      NoVisionEngineError
    )
  })

  it('auto_crop_and_retouch fails and writes nothing', async () => {
    await expect(
      autoCropAndRetouch(
        { input_path: 'a.png', output_path: 'b.png', spec_name: 'australia_passport' },
        deps
      )
    ).rejects.toThrow(NoVisionEngineError)
  })

  it('create_print_sheet fails', async () => {
    await expect(
      createPrintSheet(
        { photo_path: 'a.png', output_path: 'b.png', spec_name: 'australia_passport' },
        deps
      )
    ).rejects.toThrow(NoVisionEngineError)
  })
})

describe('runJsonProcess', () => {
  it('parses JSON stdout', async () => {
    await expect(runJsonProcess(node, script('console.log(JSON.stringify({ok:1}))'))).resolves.toEqual({ ok: 1 })
  })

  it('passes arguments without a shell', async () => {
    const out = await runJsonProcess(node, [
      ...script('console.log(JSON.stringify(process.argv.slice(1)))'),
      '$(echo pwned)',
      'a;b',
    ])
    expect(out).toEqual(['$(echo pwned)', 'a;b'])
  })

  it('rejects a non-zero exit, preferring the JSON message', async () => {
    await expect(
      runJsonProcess(node, script('console.log(JSON.stringify({success:false,message:"bad input"}));process.exit(1)'))
    ).rejects.toThrow(/exited with code 1: bad input/)
  })

  it('rejects non-JSON and empty output', async () => {
    await expect(runJsonProcess(node, script('console.log("hello")'))).rejects.toThrow(/not valid JSON/)
    await expect(runJsonProcess(node, script(''))).rejects.toThrow(/no output/)
  })

  it('kills the child on timeout', async () => {
    const started = Date.now()
    await expect(
      runJsonProcess(node, script('setTimeout(() => {}, 10000)'), { timeoutMs: 200 })
    ).rejects.toThrow(/timed out/)
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('kills the child when stdout exceeds the cap', async () => {
    await expect(
      runJsonProcess(node, script('process.stdout.write("x".repeat(100000)); setTimeout(()=>{},5000)'), {
        maxStdoutBytes: 1000,
      })
    ).rejects.toThrow(/more than 1000 bytes/)
  })

  it('reports a missing binary', async () => {
    await expect(runJsonProcess('/nonexistent/idify-vision', [])).rejects.toThrow(/Failed to start/)
  })
})
