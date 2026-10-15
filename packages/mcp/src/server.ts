import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { detectPlatformCapabilities } from './engine/index.js'
import type { PlatformCapabilities } from './engine/index.js'
import { getAllowedRoot } from './pathGuard.js'
import {
  HEX_COLOR_PATTERN,
  MAX_DPI,
  MIN_DPI,
  autoCropAndRetouch,
  createPrintSheet,
  listSpecs,
  validatePhotoCompliance,
} from './tools/index.js'
import type { ToolDeps } from './tools/index.js'

export const SERVER_NAME = 'idify-mcp'
export const SERVER_VERSION = '0.1.0'

const dpiSchema = z
  .number()
  .int()
  .min(MIN_DPI)
  .max(MAX_DPI)
const specNameSchema = z.string().trim().min(1)
const pathSchema = z.string().min(1)
const overwriteSchema = z
  .boolean()
  .optional()
  .describe('Replace output files that already exist (default: false).')

export function buildInstructions(capabilities: PlatformCapabilities, root: string): string {
  const engineLine =
    capabilities.engine === 'apple-vision'
      ? `Vision engine: apple-vision (native binary on ${capabilities.platform}/${capabilities.arch}). All four tools are available.`
      : capabilities.engine === 'onnx'
        ? `Vision engine: onnx (on-device models on ${capabilities.platform}/${capabilities.arch}). All four tools are available; head pitch and capture quality are not measured.`
        : `Vision engine: none. ${capabilities.unavailableReason}. Only list_specs works; validate_photo_compliance, auto_crop_and_retouch and create_print_sheet return an error.`
  return [
    'Idify: passport, visa and ID photo specifications and local photo processing. Nothing is sent over the network.',
    engineLine,
    `File access is confined to ${root} (IDIFY_MCP_ROOT). Paths may be relative to it. Inputs must be existing .png/.jpg/.jpeg files; outputs are never overwritten unless overwrite: true is passed.`,
  ].join('\n')
}

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

function errorResult(tool: string, err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : String(err)
  return { isError: true, content: [{ type: 'text', text: `${tool} failed: ${message}` }] }
}

async function run(tool: string, fn: () => unknown): Promise<CallToolResult> {
  try {
    return textResult(await fn())
  } catch (err) {
    return errorResult(tool, err)
  }
}

export type CreateServerOptions = ToolDeps

export function createServer(options: CreateServerOptions = {}): McpServer {
  // Start-up snapshot for the instructions; tools re-detect per call unless
  // capabilities were injected.
  const capabilities = options.capabilities ?? detectPlatformCapabilities()
  let root: string
  try {
    root = getAllowedRoot()
  } catch (err) {
    root = `<invalid: ${err instanceof Error ? err.message : String(err)}>`
  }
  const deps: ToolDeps = { engine: options.engine, capabilities: options.capabilities }

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions: buildInstructions(capabilities, root),
    }
  )

  server.registerTool(
    'list_specs',
    {
      description:
        'List official passport, visa and ID photo specifications (500+ regulations) with millimetre dimensions, head-size bounds and background rules. The result also reports which vision engine this server uses.',
      inputSchema: {
        country: z
          .string()
          .optional()
          .describe('Filter by country name or 2-letter ISO zone (e.g. "Australia", "US").'),
        type: z
          .string()
          .optional()
          .describe('Filter by photo type: "passport", "visa" or "identification".'),
        query: z.string().optional().describe('Free-text search across titles and country names.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => run('list_specs', () => listSpecs(args, options.capabilities))
  )

  server.registerTool(
    'validate_photo_compliance',
    {
      description:
        'Check a local portrait photo for ICAO-style compliance: face count, head roll and turn, horizontal centring and, with spec_name, head height against the spec. The optional apple-vision engine also checks pitch and capture quality; the default onnx engine reports those as null. headHeightRatio is measured against the INPUT image, so the head-size check is only meaningful for a photo already cropped to the spec (e.g. the output of auto_crop_and_retouch). Background-removal rules are reported as advisories, not violations. Runs locally.',
      inputSchema: {
        image_path: pathSchema.describe(
          'Path to a .png/.jpg/.jpeg photo inside the allowed root (relative paths resolve against it).'
        ),
        spec_name: specNameSchema
          .optional()
          .describe('Spec name from list_specs (e.g. "united_states_passport") to check head size against.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => run('validate_photo_compliance', () => validatePhotoCompliance(args, deps))
  )

  server.registerTool(
    'auto_crop_and_retouch',
    {
      description:
        'Frame, crop and resize a photo to a spec: positions the head to the spec\'s head-height range, optionally replaces the background (never when the spec prohibits it, e.g. Australia, Canada, New Zealand), and writes DPI metadata. Output must be a new .png/.jpg/.jpeg inside the allowed root.',
      inputSchema: {
        input_path: pathSchema.describe('Source .png/.jpg/.jpeg photo inside the allowed root.'),
        output_path: pathSchema.describe(
          'Where to write the result (.png, .jpg or .jpeg) inside the allowed root.'
        ),
        spec_name: specNameSchema.describe('Spec name from list_specs (e.g. "united_states_passport").'),
        background_color: z
          .string()
          .trim()
          .refine((v) => v.toLowerCase() === 'none' || HEX_COLOR_PATTERN.test(v), {
            message: 'must be a hex colour like "#FFFFFF" (or #RRGGBBAA) or "none"',
          })
          .optional()
          .describe('Hex colour (e.g. "#FFFFFF") or "none" to keep the original background. Default: the spec background. Ignored when the spec prohibits replacement.'),
        auto_frame: z
          .boolean()
          .optional()
          .describe('Detect the face and frame the head to the spec (default: true).'),
        dpi: dpiSchema
          .optional()
          .describe(`Output density, ${MIN_DPI}-${MAX_DPI}. Default: the spec DPI. The physical size is kept, so the pixel size scales with it.`),
        overwrite: overwriteSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => run('auto_crop_and_retouch', () => autoCropAndRetouch(args, deps))
  )

  server.registerTool(
    'create_print_sheet',
    {
      description:
        'Render a 4x6 inch (10x15 cm) print sheet PNG that tiles a processed photo as many times as fits (3 mm margin, 2 mm gutter, best orientation), with optional hairline cut guides and DPI metadata. Returns the layout (cell coordinates in pixels) and can also save it as JSON via manifest_path.',
      inputSchema: {
        photo_path: pathSchema.describe(
          'The processed single photo (.png/.jpg/.jpeg) inside the allowed root.'
        ),
        output_path: pathSchema.describe('Where to write the sheet; must end in .png.'),
        spec_name: specNameSchema.describe('Spec name from list_specs; sets the photo size in mm.'),
        sheet_dpi: dpiSchema
          .optional()
          .describe(`Sheet density, ${MIN_DPI}-${MAX_DPI} (default: 300).`),
        cut_guides: z.boolean().optional().describe('Draw hairline cut guides (default: true).'),
        manifest_path: pathSchema
          .optional()
          .describe('Optional .json path to also save the layout to.'),
        overwrite: overwriteSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => run('create_print_sheet', () => createPrintSheet(args, deps))
  )

  return server
}
