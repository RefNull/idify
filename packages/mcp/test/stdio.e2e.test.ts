import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PNG_BYTES, makeRoot, writeFile } from './helpers.js'

// Exercises the committed build, exactly as an MCP client launches it.
const entry = fileURLToPath(new URL('../dist/index.js', import.meta.url))
const nativeBinary = fileURLToPath(new URL('../native/idify-vision', import.meta.url))
const engineName =
  process.platform === 'darwin' && process.arch === 'arm64' && fs.existsSync(nativeBinary)
    ? 'apple-vision'
    : 'onnx'

type TextResult = { isError?: boolean; content: Array<{ type: string; text: string }> }
const text = (r: unknown) => (r as TextResult).content.map((c) => c.text).join('\n')

describe('stdio server (dist/index.js)', () => {
  let root: string
  let client: Client
  let stderr = ''

  beforeAll(async () => {
    root = makeRoot()
    writeFile(root, 'photo.png', PNG_BYTES)
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entry],
      cwd: root,
      env: { PATH: process.env.PATH ?? '', IDIFY_MCP_ROOT: root },
      stderr: 'pipe',
    })
    transport.stderr?.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    client = new Client({ name: 'idify-e2e', version: '0.0.0' })
    await client.connect(transport)
  }, 20000)

  afterAll(async () => {
    await client?.close()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('initializes and describes the engine and root', () => {
    expect(client.getServerVersion()?.name).toBe('idify-mcp')
    const instructions = client.getInstructions() ?? ''
    expect(instructions).toContain(root)
    expect(instructions).toContain(`Vision engine: ${engineName}`)
  })

  it('lists the four tools with backward-compatible parameters', async () => {
    const { tools } = await client.listTools()
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
    expect(Object.keys(byName).sort()).toEqual([
      'auto_crop_and_retouch',
      'create_print_sheet',
      'list_specs',
      'validate_photo_compliance',
    ])
    const props = (name: string) => Object.keys(byName[name].inputSchema.properties ?? {})
    expect(props('list_specs')).toEqual(expect.arrayContaining(['country', 'type', 'query']))
    expect(props('validate_photo_compliance')).toEqual(expect.arrayContaining(['image_path', 'spec_name']))
    expect(props('auto_crop_and_retouch')).toEqual(
      expect.arrayContaining(['input_path', 'output_path', 'spec_name', 'background_color', 'auto_frame', 'dpi', 'overwrite'])
    )
    expect(props('create_print_sheet')).toEqual(
      expect.arrayContaining(['photo_path', 'output_path', 'spec_name', 'sheet_dpi', 'cut_guides', 'manifest_path', 'overwrite'])
    )
    expect(byName.auto_crop_and_retouch.inputSchema.required).toEqual(
      expect.arrayContaining(['input_path', 'output_path', 'spec_name'])
    )
  })

  it('answers list_specs', async () => {
    const result = await client.callTool({ name: 'list_specs', arguments: { country: 'AU', type: 'passport' } })
    expect((result as TextResult).isError).toBeFalsy()
    const body = JSON.parse(text(result))
    expect(body.specs.map((s: { name: string }) => s.name)).toContain('australia_passport')
    expect(body.engine.name).toBe(engineName)
  })

  it('returns isError for an unreadable photo and writes nothing', async () => {
    const result = await client.callTool({
      name: 'auto_crop_and_retouch',
      arguments: { input_path: 'photo.png', output_path: 'out.png', spec_name: 'united_states_passport' },
    })
    expect((result as TextResult).isError).toBe(true)
    expect(fs.readdirSync(root)).toEqual(['photo.png'])
  })

  it('returns isError for invalid arguments', async () => {
    const missing = await client.callTool({ name: 'auto_crop_and_retouch', arguments: { input_path: 'photo.png' } })
    expect((missing as TextResult).isError).toBe(true)
    expect(text(missing)).toMatch(/spec_name|output_path/)

    const badDpi = await client.callTool({
      name: 'create_print_sheet',
      arguments: { photo_path: 'photo.png', output_path: 's.png', spec_name: 'australia_passport', sheet_dpi: 5000 },
    })
    expect((badDpi as TextResult).isError).toBe(true)

    const badColour = await client.callTool({
      name: 'auto_crop_and_retouch',
      arguments: { input_path: 'photo.png', output_path: 'o.png', spec_name: 'australia_passport', background_color: 'javascript:1' },
    })
    expect((badColour as TextResult).isError).toBe(true)
    expect(text(badColour)).toMatch(/hex colour/)
  })

  it('writes nothing but protocol to stdout (no stray stderr noise either)', () => {
    // Any non-JSON on stdout would have broken the client before this point.
    expect(stderr).toBe('')
    expect(path.isAbsolute(entry)).toBe(true)
  })
})
