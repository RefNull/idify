import { IDPhotoSpec } from '../types'
import {
  EYE_IN_HEAD,
  getHeadRatioRange,
  getPlacementRules,
  solveCrown,
} from './placement'

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

/**
 * The crop rectangle (in source pixels) that puts the head where the spec
 * wants it (see placement.ts, shared with the on-screen guide), centred
 * horizontally, using this face's measured eye position.
 */
export function getAutoCropArea(
  head: HeadBox,
  spec: Pick<IDPhotoSpec, 'dimension' | 'rules'>,
  image: { width: number; height: number }
) {
  const rules = getPlacementRules(spec)
  const { target, max } = getHeadRatioRange(rules)
  const crownPx = head.top * image.height
  const headPx = (head.bottom - head.top) * image.height
  const eyeInHead =
    head.eyes !== undefined && head.bottom > head.top
      ? (head.eyes - head.top) / (head.bottom - head.top)
      : EYE_IN_HEAD
  const aspect = spec.dimension.width / spec.dimension.height

  const frame = (headRatio: number) => {
    const height = headPx / headRatio
    const width = height * aspect
    const { crown } = solveCrown(rules, headRatio, eyeInHead)
    const x = head.centerX * image.width - width / 2
    const y = crownPx - crown * height
    return { x, y, width, height }
  }
  const inside = (f: ReturnType<typeof frame>) =>
    f.x >= 0 &&
    f.y >= 0 &&
    f.x + f.width <= image.width + 1e-6 &&
    f.y + f.height <= image.height + 1e-6

  // If the frame runs past the photo, zoom in towards the largest allowed
  // head size rather than leave a blank strip.
  let best = frame(target)
  const steps = 8
  for (let i = 1; i <= steps && !inside(best); i++) {
    best = frame(target + ((max - target) * i) / steps)
  }
  // Still too little room: shift the frame back inside the photo, giving up
  // a little centring or headroom rather than adding blank edges.
  const clamp = (value: number, size: number, limit: number) =>
    size <= limit ? Math.min(Math.max(value, 0), limit - size) : (limit - size) / 2
  return {
    x: clamp(best.x, best.width, image.width),
    y: clamp(best.y, best.height, image.height),
    width: best.width,
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
