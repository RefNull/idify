import { RetouchAdjustment, RetouchBackground } from '../stores'
import { IDPhotoDimension } from './pure'
import {
  createGLFXCanvas,
  drawCanvasBackground,
  renderGLFXAdjustment,
} from './canvas'
import { withPngDensity } from './png'
import { encodeWithinSize } from './compliance'
import { CropArea, getCropOutputSize, getCropTransform } from './crop'

export type { IDPhotoDimension }

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', (error) => reject(error))
    image.setAttribute('crossOrigin', 'anonymous')
    image.src = url
  })
}

export async function cropIDPhoto({
  image: imageURL,
  area,
  rotation,
  flipHorizontal = false,
  flipVertical = false,
  resolution,
  sourceSize,
}: {
  image: string
  area: CropArea
  rotation: number
  flipHorizontal?: boolean
  flipVertical?: boolean
  resolution: {
    width: number
    height: number
  }
  /**
   * Treat the image as if it were this size: for cropping one image with an
   * area measured on another of the same shape but a different resolution.
   */
  sourceSize?: {
    width: number
    height: number
  }
}): Promise<string> {
  if (!(area.width > 0) || !(area.height > 0)) {
    throw new Error('Empty crop area')
  }
  const image = await loadImage(imageURL)
  const imageWidth = sourceSize?.width || image.naturalWidth || image.width
  const imageHeight = sourceSize?.height || image.naturalHeight || image.height
  // Supersample for the retouch step, but keep the canvas within the limits
  // mobile browsers can allocate.
  const output = getCropOutputSize(resolution)
  const canvas = document.createElement('canvas')
  canvas.width = output.width
  canvas.height = output.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable')
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // One transform straight from the source: no full-size rotated intermediate.
  ctx.setTransform(
    ...getCropTransform({
      imageWidth,
      imageHeight,
      rotation,
      flipHorizontal,
      flipVertical,
      area,
      outputWidth: output.width,
      outputHeight: output.height,
    })
  )
  ctx.drawImage(image, 0, 0, imageWidth, imageHeight)
  return new Promise((resolve, reject) => {
    canvas.toBlob((file) => {
      // Release the backing store early; large canvases add up on iOS.
      canvas.width = 0
      canvas.height = 0
      if (file) {
        resolve(URL.createObjectURL(file))
      } else {
        reject(new Error('failed'))
      }
    }, 'image/png')
  })
}

/**
 * Crop the original photo to match a crop of its cutout, whose area was
 * measured on the cutout. Background removal may return a different
 * resolution, so the original is scaled to the cutout's size first. Returns
 * undefined when the two do not have the same shape (e.g. one was rotated
 * by its EXIF orientation and the other not), as they cannot be lined up.
 */
export async function cropMatchingOriginal({
  image: originalURL,
  cutout: cutoutURL,
  ...options
}: Omit<Parameters<typeof cropIDPhoto>[0], 'sourceSize'> & {
  cutout: string
}): Promise<string | undefined> {
  const [original, cutout] = await Promise.all([
    loadImage(originalURL),
    loadImage(cutoutURL),
  ])
  const sourceSize = {
    width: cutout.naturalWidth || cutout.width,
    height: cutout.naturalHeight || cutout.height,
  }
  const originalAspect =
    (original.naturalWidth || original.width) /
    (original.naturalHeight || original.height)
  if (
    Math.abs(sourceSize.width / sourceSize.height / originalAspect - 1) > 0.01
  ) {
    return undefined
  }
  return cropIDPhoto({ ...options, image: originalURL, sourceSize })
}

/**
 * Blend part of the original background back into a cutout: the original
 * photo drawn at `1 - removal` opacity under the cutout. At 1 the result is
 * the plain cutout, at 0 the original photo. Both images must be the same
 * crop. Returns a PNG blob URL.
 */
export async function mixOriginalBackground(
  cutoutURL: string,
  originalURL: string,
  removal: number
): Promise<string> {
  const [cutout, original] = await Promise.all([
    loadImage(cutoutURL),
    loadImage(originalURL),
  ])
  const canvas = document.createElement('canvas')
  canvas.width = cutout.naturalWidth || cutout.width
  canvas.height = cutout.naturalHeight || cutout.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable')
  }
  ctx.globalAlpha = Math.min(Math.max(1 - removal, 0), 1)
  ctx.drawImage(original, 0, 0, canvas.width, canvas.height)
  ctx.globalAlpha = 1
  ctx.drawImage(cutout, 0, 0, canvas.width, canvas.height)
  return new Promise((resolve, reject) => {
    canvas.toBlob((file) => {
      canvas.width = 0
      canvas.height = 0
      if (file) {
        resolve(URL.createObjectURL(file))
      } else {
        reject(new Error('failed'))
      }
    }, 'image/png')
  })
}

/** Render one finished ID photo (background + adjustments) onto a canvas. */
export async function renderIDPhotoCanvas({
  image: imageURL,
  background,
  adjustment,
  resolution,
}: {
  image: string
  background: RetouchBackground
  adjustment: RetouchAdjustment
  resolution: {
    width: number
    height: number
  }
}): Promise<HTMLCanvasElement | null> {
  const image = await loadImage(imageURL)
  const canvas = document.createElement('canvas')
  canvas.width = resolution.width
  canvas.height = resolution.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }
  drawCanvasBackground(canvas, background)
  const fxs = createGLFXCanvas(image)
  fxs.canvas.width = image.naturalWidth
  fxs.canvas.height = image.naturalHeight
  renderGLFXAdjustment(fxs.canvas, fxs.texture, adjustment)
  ctx.drawImage(
    fxs.canvas,
    0,
    0,
    image.naturalWidth,
    image.naturalHeight,
    0,
    0,
    resolution.width,
    resolution.height
  )
  return canvas
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type = 'image/png',
  quality?: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (file) => {
        if (file) {
          resolve(file)
        } else {
          reject(new Error('failed'))
        }
      },
      type,
      quality
    )
  })
}

/**
 * Render the finished ID photo. With `maxKB` (a spec's upload limit) it is a
 * JPEG at the highest quality that fits, as online submissions expect;
 * otherwise a PNG carrying the print density.
 */
export async function createIDPhoto({
  image,
  background,
  adjustment,
  resolution,
  maxKB,
}: {
  image: string
  background: RetouchBackground
  adjustment: RetouchAdjustment
  resolution: {
    width: number
    height: number
    dpi?: number
  }
  maxKB?: number
}): Promise<Blob | null> {
  const canvas = await renderIDPhotoCanvas({
    image,
    background,
    adjustment,
    resolution,
  })
  if (!canvas) {
    return null
  }
  if (maxKB && maxKB > 0) {
    // JPEG has no transparency: put a transparent background on white.
    const flat = document.createElement('canvas')
    flat.width = canvas.width
    flat.height = canvas.height
    const ctx = flat.getContext('2d')
    if (!ctx) {
      return null
    }
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, flat.width, flat.height)
    ctx.drawImage(canvas, 0, 0)
    return encodeWithinSize(
      (quality) => canvasToBlob(flat, 'image/jpeg', quality),
      maxKB * 1024
    )
  }
  const blob = await canvasToBlob(canvas)
  return resolution.dpi ? withPngDensity(blob, resolution.dpi) : blob
}
