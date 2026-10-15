/**
 * Passport and visa authorities (ICAO 9303 and most national rules) reject
 * tinted, monochrome or noisy photos and non-uniform backgrounds. These
 * helpers decide when the retouch tools should warn. Pure, no DOM.
 */
import type {
  RetouchAdjustment,
  RetouchBackground,
} from '../stores/RetouchStore'
import { IDPhotoSpec } from '../types'

/** Specs whose authorities expect an unfiltered photo on a plain background. */
export function isStrictSpec(spec: Pick<IDPhotoSpec, 'type'> | undefined) {
  return spec?.type === 'passport' || spec?.type === 'visa'
}

/** True when the adjustment goes beyond neutral brightness/contrast fixes. */
export function isNonNeutralAdjustment(adjustment: RetouchAdjustment) {
  const { saturation = 0, sepia = 0, noise = 0, vibrance = 0 } = adjustment
  return (
    saturation <= -0.5 ||
    saturation > 0.1 ||
    sepia > 0 ||
    noise > 0 ||
    vibrance > 0.1
  )
}

/** Mirrors drawCanvasBackground: a gradient is drawn when |brightness| >= 0.1. */
export function hasGradientBackground(background: RetouchBackground) {
  const { brightness } = background.gradient
  return background.color !== 'transparent' && Math.abs(brightness) >= 0.1
}

/**
 * Compare a saved file against a spec's `rules.size` (max KB, 1 KB = 1024
 * bytes). Null when the spec has no limit or the file is within it.
 */
export function getFileSizeExcess(
  bytes: number,
  spec: Pick<IDPhotoSpec, 'rules'> | undefined
): { actualKB: number; maxKB: number } | null {
  const maxKB = spec?.rules?.size
  if (!maxKB || !(maxKB > 0) || bytes <= maxKB * 1024) {
    return null
  }
  return { actualKB: Math.ceil(bytes / 1024), maxKB }
}
