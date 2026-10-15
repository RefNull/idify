import { RetouchAdjustment, RetouchBackground } from '../stores'
import { IDPhotoDimension } from './pure'
import {
  createGLFXCanvas,
  drawCanvasBackground,
  renderGLFXAdjustment,
} from './canvas'
import { withPngDensity } from './png'
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
}): Promise<string> {
  if (!(area.width > 0) || !(area.height > 0)) {
    throw new Error('Empty crop area')
  }
  const image = await loadImage(imageURL)
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
      imageWidth: image.naturalWidth || image.width,
      imageHeight: image.naturalHeight || image.height,
      rotation,
      flipHorizontal,
      flipVertical,
      area,
      outputWidth: output.width,
      outputHeight: output.height,
    })
  )
  ctx.drawImage(image, 0, 0)
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

function canvasToPNG(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((file) => {
      if (file) {
        resolve(file)
      } else {
        reject(new Error('failed'))
      }
    }, 'image/png')
  })
}

export async function createIDPhoto({
  image,
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
    dpi?: number
  }
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
  const blob = await canvasToPNG(canvas)
  return resolution.dpi ? withPngDensity(blob, resolution.dpi) : blob
}
