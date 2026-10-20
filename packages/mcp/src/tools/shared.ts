import type { PlatformCapabilities, VisionEngine } from '../engine/index.js'

/**
 * Injection points for tests. Production code passes neither, so the engine
 * is detected on every call.
 */
export interface ToolDeps {
  engine?: VisionEngine
  capabilities?: PlatformCapabilities
}

export const HEX_COLOR_PATTERN = /^#?[0-9a-f]{6}([0-9a-f]{2})?$/i

/** "#ffffff" style, lower-case, always with the leading '#'. */
export function normalizeHex(value: string): string {
  const trimmed = value.trim()
  if (!HEX_COLOR_PATTERN.test(trimmed)) {
    throw new Error(`Invalid colour "${value}"; expected #RRGGBB, #RRGGBBAA or "none"`)
  }
  return `#${trimmed.replace(/^#/, '').toLowerCase()}`
}

export const MIN_DPI = 72
export const MAX_DPI = 1200
