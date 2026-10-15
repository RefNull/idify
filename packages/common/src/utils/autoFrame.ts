import { IDPhotoSpec } from '../types'
import { getHeadGuideMetrics } from './pure'

/**
 * Automatic head framing.
 *
 * The chin and the eye line come from the face detector. The crown (top of
 * the hair) comes from the background-removal mask when it is available: the
 * first row above the face where the person silhouette covers the middle of
 * the face's columns. Without a mask the crown is estimated from the eye
 * line, which sits about halfway between crown and chin on an adult head.
 * Everything here works in fractions of the image size (0..1).
 */

export interface HeadBox {
  /** Crown (top of hair). */
  top: number
  /** Chin. */
  bottom: number
  /** Horizontal centre of the head. */
  centerX: number
  /** Eye line, when known. */
  eyes?: number
}

export interface FaceBox {
  x: number
  y: number
  width: number
  height: number
  /** Right eye, left eye, nose tip, right and left mouth corners. */
  landmarks: [number, number][]
}

export interface MaskData {
  data: Uint8ClampedArray
  width: number
  height: number
}

const SOLID = 128

/**
 * Top of the person silhouette above the face: the first row in which at
 * least `cover` of the face's middle columns are solid. Null if the mask has
 * nothing there.
 */
export function findCrownInMask(
  mask: MaskData,
  face: FaceBox,
  cover = 0.15
): number | null {
  const { data, width, height } = mask
  const x0 = Math.max(0, Math.floor((face.x + face.width * 0.2) * width))
  const x1 = Math.min(width - 1, Math.ceil((face.x + face.width * 0.8) * width))
  const yEnd = Math.min(height, Math.ceil((face.y + face.height / 2) * height))
  const need = Math.max(1, (x1 - x0 + 1) * cover)
  for (let y = 0; y < yEnd; y++) {
    let solid = 0
    for (let x = x0; x <= x1; x++) {
      if (data[(y * width + x) * 4 + 3] >= SOLID) solid++
    }
    if (solid >= need) return y / height
  }
  return null
}

/** Crown, chin and centre of the head from a detected face (and mask). */
export function getHeadBox(face: FaceBox, mask?: MaskData | null): HeadBox {
  const [rightEye, leftEye] = face.landmarks
  const eyeY = (rightEye[1] + leftEye[1]) / 2
  const chin = face.y + face.height
  const eyeToChin = Math.max(chin - eyeY, 1e-6)
  // Eye line about halfway down the head; hair adds a little on top.
  let crown = eyeY - eyeToChin * 1.05
  const fromMask = mask ? findCrownInMask(mask, face) : null
  if (fromMask !== null) {
    // Ignore the mask when it runs far above the head (hat, raised hand,
    // or a second person behind).
    crown = Math.max(fromMask, eyeY - eyeToChin * 1.8)
  }
  return {
    top: Math.max(0, crown),
    bottom: chin,
    centerX: (rightEye[0] + leftEye[0]) / 2,
    eyes: eyeY,
  }
}

/** Head height used when a spec has no composition rules. */
const DEFAULT_HEAD_RATIO = 0.6
/** Without a crown or eye rule: share of the free space above the crown. */
const TOP_SHARE = 0.4

/**
 * The crop rectangle (in source pixels) that puts the head where the spec
 * wants it, centred horizontally, with the head height in the middle of the
 * allowed range. Vertically, the eye line goes to the middle of the spec's
 * eye-height range if it has one; otherwise the crown goes on the required
 * clear-space line (where the on-screen guide draws it).
 */
export function getAutoCropArea(
  head: HeadBox,
  spec: Pick<IDPhotoSpec, 'dimension' | 'rules'>,
  image: { width: number; height: number }
) {
  const metrics = getHeadGuideMetrics(spec as IDPhotoSpec)
  let ratio = DEFAULT_HEAD_RATIO
  let maxRatio = DEFAULT_HEAD_RATIO
  if (metrics) {
    const { minHead, maxHead } = metrics
    ratio =
      minHead > 0 && maxHead > 0
        ? (minHead + maxHead) / 2
        : Math.max(minHead, maxHead)
    maxRatio = Math.max(ratio, maxHead)
  }
  ratio = Math.min(Math.max(ratio, 0.2), 0.9)
  maxRatio = Math.min(Math.max(maxRatio, ratio), 0.9)
  const crownOffset = metrics?.crownOffset ?? 0
  const { minEyeHeight = 0, maxEyeHeight = 0 } = spec.rules ?? {}
  const eyeHeight =
    minEyeHeight > 0 && maxEyeHeight > 0
      ? (minEyeHeight + maxEyeHeight) / 2
      : Math.max(minEyeHeight, maxEyeHeight)

  const crownPx = head.top * image.height
  const headPx = (head.bottom - head.top) * image.height
  const eyePx = head.eyes === undefined ? null : head.eyes * image.height
  const aspect = spec.dimension.width / spec.dimension.height

  const frame = (headRatio: number) => {
    const height = headPx / headRatio
    let y: number
    if (eyeHeight > 0 && eyePx !== null) {
      // Eye height is measured from the bottom edge.
      y = eyePx - (1 - eyeHeight) * height
    } else if (crownOffset > 0) {
      y = crownPx - crownOffset * height
    } else {
      y = crownPx - (1 - headRatio) * TOP_SHARE * height
    }
    return { y, height }
  }

  // If the photo runs out above the head, zoom in towards the largest
  // allowed head size rather than leave a blank strip at the top.
  let best = frame(ratio)
  const steps = 8
  for (let i = 1; i <= steps && best.y < 0; i++) {
    best = frame(ratio + ((maxRatio - ratio) * i) / steps)
  }
  // Still too little room: keep to the photo, with less headroom than asked.
  const y = Math.max(0, best.y)

  const width = best.height * aspect
  return {
    x: head.centerX * image.width - width / 2,
    y,
    width,
    height: best.height,
  }
}

/** Load a cutout's alpha mask, downscaled so its longest side is `maxSide`. */
export async function loadMask(
  url: string,
  maxSide = 480
): Promise<MaskData | null> {
  const blob = await fetch(url).then((response) => response.blob())
  const bitmap = await createImageBitmap(blob)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    bitmap.close()
    return null
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const { data } = ctx.getImageData(0, 0, width, height)
  return { data, width, height }
}
