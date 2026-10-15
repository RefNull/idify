/**
 * Pure maths for turning a react-easy-crop selection into the saved photo.
 * No DOM, so it can be unit-tested in Node.
 *
 * react-easy-crop reports `croppedAreaPixels` in the frame of the source image
 * rotated by `rotation` about its centre, placed in its rotated bounding box.
 * It knows nothing about flips, which LiveCropper applies as an extra CSS
 * transform: `rotateZ(rotation) rotateY(flipH) rotateX(flipV)`, i.e. the image
 * is mirrored about its centre first and rotated second. So an image pixel `p`
 * lands at `q = bboxCentre + R * F * (p - imageCentre)` in the frame the crop
 * area is measured in, and the output pixel is `(q - area.xy) * outputScale`.
 */

/** A 2D affine transform in canvas `setTransform(a, b, c, d, e, f)` order. */
export type Matrix2D = [number, number, number, number, number, number]

export interface CropArea {
  x: number
  y: number
  width: number
  height: number
}

export interface CropTransformOptions {
  imageWidth: number
  imageHeight: number
  /** Degrees, clockwise on screen (CSS `rotateZ`). */
  rotation: number
  flipHorizontal?: boolean
  flipVertical?: boolean
  area: CropArea
  outputWidth: number
  outputHeight: number
}

/** Canvas limit used by iOS Safari (4096 x 4096); larger canvases fail. */
export const MAX_CANVAS_PIXELS = 16_777_216

/** Preferred supersampling factors for the crop output, best first. */
export const CROP_OUTPUT_SCALES = [3, 2, 1]

export function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180
}

/** Size of the axis-aligned box around a `width x height` rect rotated by `rotation` degrees. */
export function rotatedBoundingBox(
  width: number,
  height: number,
  rotation: number
) {
  const rad = toRadians(rotation)
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  return {
    width: cos * width + sin * height,
    height: sin * width + cos * height,
  }
}

/**
 * The transform that draws the source image (at 0,0, natural size) straight
 * into the output canvas so it matches what LiveCropper shows.
 */
export function getCropTransform({
  imageWidth,
  imageHeight,
  rotation,
  flipHorizontal = false,
  flipVertical = false,
  area,
  outputWidth,
  outputHeight,
}: CropTransformOptions): Matrix2D {
  const rad = toRadians(rotation)
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const fx = flipHorizontal ? -1 : 1
  const fy = flipVertical ? -1 : 1
  const sx = outputWidth / area.width
  const sy = outputHeight / area.height
  const bbox = rotatedBoundingBox(imageWidth, imageHeight, rotation)
  // Image centre moved to the origin, then mirrored: (fx * -w/2, fy * -h/2).
  const ox = -fx * (imageWidth / 2)
  const oy = -fy * (imageHeight / 2)
  const tx = bbox.width / 2 - area.x
  const ty = bbox.height / 2 - area.y
  return [
    sx * cos * fx,
    sy * sin * fx,
    -sx * sin * fy,
    sy * cos * fy,
    sx * (cos * ox - sin * oy + tx),
    sy * (sin * ox + cos * oy + ty),
  ]
}

/** Apply a transform to a point. */
export function applyMatrix(
  [a, b, c, d, e, f]: Matrix2D,
  x: number,
  y: number
) {
  return { x: a * x + c * y + e, y: b * x + d * y + f }
}

/**
 * The largest supersampling factor whose output stays within `maxPixels`.
 * Falls back below 1x (keeping the aspect ratio) only when even 1x is too big.
 */
export function pickOutputScale(
  width: number,
  height: number,
  maxPixels = MAX_CANVAS_PIXELS,
  scales = CROP_OUTPUT_SCALES
) {
  for (const scale of scales) {
    if (Math.round(width * scale) * Math.round(height * scale) <= maxPixels) {
      return scale
    }
  }
  return Math.sqrt(maxPixels / (width * height))
}

/** Whole-pixel output size for a spec resolution, capped to the canvas limit. */
export function getCropOutputSize(
  resolution: { width: number; height: number },
  maxPixels = MAX_CANVAS_PIXELS
) {
  const scale = pickOutputScale(resolution.width, resolution.height, maxPixels)
  let width = Math.max(1, Math.round(resolution.width * scale))
  let height = Math.max(1, Math.round(resolution.height * scale))
  // Rounding a fractional scale up can overshoot by a row or column.
  while (width * height > maxPixels && width > 1 && height > 1) {
    if (width >= height) {
      width -= 1
    } else {
      height -= 1
    }
  }
  return { width, height, scale }
}
