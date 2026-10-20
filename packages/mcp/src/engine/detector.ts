import fs from 'node:fs'
import path from 'node:path'
import { packageDir } from './models.js'

export type VisionEngineType = 'onnx' | 'apple-vision' | 'none'

export interface PlatformCapabilities {
  platform: NodeJS.Platform
  arch: string
  isAppleSilicon: boolean
  engine: VisionEngineType
  hasNativeBinary: boolean
  nativeBinaryPath: string | null
  /** Tools that need a vision engine; empty when none is available. */
  visionTools: string[]
  /** Why no engine is available, or null when one is. */
  unavailableReason: string | null
}

export const VISION_TOOLS = [
  'validate_photo_compliance',
  'auto_crop_and_retouch',
  'create_print_sheet',
]

export const DEFAULT_BINARY_PATH = path.join(packageDir(), 'native/idify-vision')

export interface DetectOptions {
  platform?: NodeJS.Platform
  arch?: string
  binaryPath?: string
  binaryExists?: (p: string) => boolean
  /** IDIFY_MCP_ENGINE: "onnx", "apple-vision" or unset for automatic. */
  preference?: string
}

function isExecutableFile(p: string): boolean {
  try {
    fs.accessSync(p, fs.constants.X_OK)
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * The onnx engine runs everywhere. The optional Apple Vision binary is used
 * instead when it has been built on an Apple Silicon Mac, unless
 * IDIFY_MCP_ENGINE=onnx; IDIFY_MCP_ENGINE=apple-vision insists on it.
 */
export function detectPlatformCapabilities(options: DetectOptions = {}): PlatformCapabilities {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const binaryPath = options.binaryPath ?? DEFAULT_BINARY_PATH
  const exists = options.binaryExists ?? isExecutableFile
  const preference = (options.preference ?? process.env.IDIFY_MCP_ENGINE ?? '').trim().toLowerCase()

  const isAppleSilicon = platform === 'darwin' && arch === 'arm64'
  const hasNativeBinary = isAppleSilicon && exists(binaryPath)

  let engine: VisionEngineType = hasNativeBinary && preference !== 'onnx' ? 'apple-vision' : 'onnx'
  let unavailableReason: string | null = null
  if (preference === 'apple-vision' && !hasNativeBinary) {
    engine = 'none'
    unavailableReason =
      `IDIFY_MCP_ENGINE=apple-vision, but the native binary is not available on ${platform}/${arch}; ` +
      'it needs macOS on Apple Silicon and "pnpm --filter @idify/mcp build:native"'
  }

  return {
    platform,
    arch,
    isAppleSilicon,
    engine,
    hasNativeBinary,
    nativeBinaryPath: hasNativeBinary ? binaryPath : null,
    visionTools: engine === 'none' ? [] : [...VISION_TOOLS],
    unavailableReason,
  }
}
