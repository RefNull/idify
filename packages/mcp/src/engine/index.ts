import { detectPlatformCapabilities } from './detector.js'
import type { PlatformCapabilities } from './detector.js'
import { AppleVisionEngine } from './apple-vision.js'
import { OnnxEngine } from './onnx.js'
import type { VisionEngine } from './types.js'

export * from './detector.js'
export type * from './types.js'
export * from './apple-vision.js'
export * from './onnx.js'
export * from './runProcess.js'

export class NoVisionEngineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoVisionEngineError'
  }
}

/**
 * The selected engine, or a NoVisionEngineError explaining why there is none.
 * Detection runs per call so a binary built after start-up is picked up.
 */
let onnxEngine: OnnxEngine | null = null

export function requireVisionEngine(
  capabilities: PlatformCapabilities = detectPlatformCapabilities()
): VisionEngine {
  if (capabilities.engine === 'apple-vision' && capabilities.nativeBinaryPath) {
    return new AppleVisionEngine(capabilities.nativeBinaryPath)
  }
  if (capabilities.engine === 'onnx') {
    onnxEngine ??= new OnnxEngine()
    return onnxEngine
  }
  throw new NoVisionEngineError(
    capabilities.unavailableReason ??
      `no vision engine available on ${capabilities.platform}/${capabilities.arch}`
  )
}
