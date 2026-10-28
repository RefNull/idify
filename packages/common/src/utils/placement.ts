import { IDPhotoSpec } from '../types'

/**
 * Where a spec wants the head, shared by the on-screen guide and automatic
 * framing so the two always agree. All values are fractions of the photo
 * height, measured from the top edge unless a name says otherwise.
 */

/**
 * The eye line's share of the crown-to-chin height on a typical head (eyes
 * about halfway down; hair adds a little on top). Automatic framing uses the
 * measured value instead when it has a detected face.
 */
export const EYE_IN_HEAD = 1.05 / 2.05

/** Head height used when a spec has no head-size rules. */
export const DEFAULT_HEAD_RATIO = 0.6
/** With only a minimum head height, aim this much above it. */
const ABOVE_MIN_HEAD = 0.03
/** Without a crown or eye rule: share of the free space above the crown. */
const TOP_SHARE = 0.4

export interface PlacementRules {
  /** 0 when the spec does not set the bound. */
  minHead: number
  maxHead: number
  /** Minimum clear space above the crown. */
  crownOffset: number
  /** Maximum clear space above the crown. */
  maxCrownOffset: number
  /** Clear space below the chin, above the bottom edge. */
  minChin: number
  maxChin: number
  /** Eye line height above the bottom edge. */
  minEye: number
  maxEye: number
}

export function getPlacementRules(
  spec: Pick<IDPhotoSpec, 'rules'>
): PlacementRules {
  const {
    minHeadHeight = 0,
    maxHeadHeight = 0,
    minHeadOffset = 0,
    maxHeadOffset = 0,
    minChinOffset = 0,
    maxChinOffset = 0,
    minEyeHeight = 0,
    maxEyeHeight = 0,
  } = spec.rules ?? {}
  const positive = (n: number) => (n > 0 ? n : 0)
  return {
    minHead: positive(minHeadHeight),
    maxHead: positive(maxHeadHeight),
    crownOffset: positive(minHeadOffset),
    maxCrownOffset: positive(maxHeadOffset),
    minChin: positive(minChinOffset),
    maxChin: positive(maxChinOffset),
    minEye: positive(minEyeHeight),
    maxEye: positive(maxEyeHeight),
  }
}

/** The head height to aim for, and the largest one allowed. */
export function getHeadRatioRange(rules: PlacementRules) {
  const { minHead, maxHead } = rules
  let target = DEFAULT_HEAD_RATIO
  if (minHead > 0 && maxHead > 0) {
    target = (minHead + maxHead) / 2
  } else if (minHead > 0) {
    target = minHead + ABOVE_MIN_HEAD
  } else if (maxHead > 0) {
    target = maxHead - ABOVE_MIN_HEAD
  }
  target = Math.min(Math.max(target, 0.2), 0.9)
  const max = Math.min(Math.max(maxHead > 0 ? maxHead : target, target), 0.9)
  return { target, max }
}

/**
 * The crown position for a head of height `headRatio` whose eye line sits
 * `eyeInHead` of the way down it. The eye line goes to the middle of the
 * spec's eye band when it has both bounds; otherwise the crown goes in the
 * middle of its clear-space band, on the required clear-space line, or a
 * little above the middle of the free space. The result is then kept inside
 * every rule that can be met: clear space above the crown and below the chin,
 * the eye band and the chin inside the photo. `fits` is false when they
 * cannot all be met at this head height.
 */
export function solveCrown(
  rules: PlacementRules,
  headRatio: number,
  eyeInHead = EYE_IN_HEAD
) {
  const { crownOffset, maxCrownOffset, minChin, maxChin, minEye, maxEye } =
    rules
  const eyeDrop = eyeInHead * headRatio
  let lo = crownOffset
  let hi = 1 - headRatio
  if (maxCrownOffset > 0) hi = Math.min(hi, maxCrownOffset)
  if (minChin > 0) hi = Math.min(hi, 1 - minChin - headRatio)
  if (maxChin > 0) lo = Math.max(lo, 1 - maxChin - headRatio)
  if (minEye > 0) hi = Math.min(hi, 1 - minEye - eyeDrop)
  if (maxEye > 0) lo = Math.max(lo, 1 - maxEye - eyeDrop)

  let crown: number
  if (minEye > 0 && maxEye > 0) {
    crown = 1 - (minEye + maxEye) / 2 - eyeDrop
  } else if (crownOffset > 0 && maxCrownOffset > 0) {
    crown = (crownOffset + maxCrownOffset) / 2
  } else if (crownOffset > 0) {
    crown = crownOffset
  } else {
    crown = (1 - headRatio) * TOP_SHARE
  }
  const fits = lo <= hi + 1e-9
  crown = fits ? Math.min(Math.max(crown, lo), hi) : Math.max(crown, lo)
  return { crown, fits }
}

export interface HeadPlacement extends PlacementRules {
  /** Target head height. */
  headRatio: number
  /** Target crown and chin. */
  crown: number
  chin: number
  /** Target eye line, from the top, on a typical head. */
  eyes: number
}

/** The target head position for a spec, or null if it sets no head rules. */
export function getHeadPlacement(
  spec: Pick<IDPhotoSpec, 'rules'>
): HeadPlacement | null {
  const rules = getPlacementRules(spec)
  if (rules.minHead <= 0 && rules.maxHead <= 0) return null
  const headRatio = getHeadRatioRange(rules).target
  const { crown } = solveCrown(rules, headRatio)
  return {
    ...rules,
    headRatio,
    crown,
    chin: crown + headRatio,
    eyes: crown + EYE_IN_HEAD * headRatio,
  }
}
