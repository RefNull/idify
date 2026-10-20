/**
 * Clean up the soft edge of a background-removal cutout.
 *
 * The segmentation mask is computed at low resolution and scaled up, so the
 * subject's outline is a wide band of semi-transparent pixels whose colour is
 * still a mix of subject and the original backdrop (often a white wall). Over
 * a new background that band shows as a pale halo. Two steps fix it:
 *
 * 1. Tighten the alpha ramp so the band is narrower and centred on the edge.
 * 2. Decontaminate the colour of what remains: each semi-transparent pixel
 *    takes the colour of the nearest opaque subject pixels, found by growing
 *    outwards from the opaque area one ring at a time.
 */

export interface MatteOptions {
  /** Alpha (0-255) at or below which a pixel becomes fully transparent. */
  low?: number
  /** Alpha (0-255) at or above which a pixel becomes fully opaque. */
  high?: number
}

const OPAQUE = 250

/** Remap alpha linearly from [low, high] to [0, 255]. */
export function tightenAlpha(alpha: number, low: number, high: number) {
  if (alpha <= low) return 0
  if (alpha >= high) return 255
  return Math.round(((alpha - low) / (high - low)) * 255)
}

/**
 * Refine RGBA pixel data (unpremultiplied, as from getImageData) in place.
 */
export function refineMatte(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  { low = 48, high = 208 }: MatteOptions = {}
) {
  const count = width * height
  if (data.length < count * 4) {
    throw new Error('Pixel data is smaller than width x height')
  }

  // 0: transparent or untouched, 1: opaque (colour source), 2: edge to fill.
  const state = new Uint8Array(count)
  let edges = 0
  for (let i = 0; i < count; i++) {
    const a = tightenAlpha(data[i * 4 + 3], low, high)
    data[i * 4 + 3] = a
    if (a >= OPAQUE) {
      state[i] = 1
    } else if (a > 0) {
      state[i] = 2
      edges++
    }
  }
  if (!edges) return

  const fill = new Float32Array(count * 3)
  const queued = new Uint8Array(count)
  let frontier: number[] = []
  const neighbours = (i: number, visit: (n: number) => void) => {
    const x = i % width
    const y = (i - x) / width
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy
      if (ny < 0 || ny >= height) continue
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue
        const nx = x + dx
        if (nx < 0 || nx >= width) continue
        visit(ny * width + nx)
      }
    }
  }

  for (let i = 0; i < count; i++) {
    if (state[i] !== 2) continue
    neighbours(i, (n) => {
      if (state[n] === 1 && !queued[i]) {
        queued[i] = 1
        frontier.push(i)
      }
    })
  }

  // Grow from the opaque area one ring at a time; each ring averages the
  // colours of the rings already filled, so colour flows outwards.
  const colour = (n: number, c: number) =>
    state[n] === 1 ? data[n * 4 + c] : fill[n * 3 + c]
  const filled = new Uint8Array(count)
  while (frontier.length) {
    for (const i of frontier) {
      let r = 0
      let g = 0
      let b = 0
      let k = 0
      neighbours(i, (n) => {
        if (state[n] === 1 || filled[n]) {
          r += colour(n, 0)
          g += colour(n, 1)
          b += colour(n, 2)
          k++
        }
      })
      fill[i * 3] = r / k
      fill[i * 3 + 1] = g / k
      fill[i * 3 + 2] = b / k
    }
    for (const i of frontier) filled[i] = 1
    const next: number[] = []
    for (const i of frontier) {
      neighbours(i, (n) => {
        if (state[n] === 2 && !queued[n]) {
          queued[n] = 1
          next.push(n)
        }
      })
    }
    frontier = next
  }

  for (let i = 0; i < count; i++) {
    if (!filled[i]) continue
    // Nearly opaque pixels keep most of their own colour; faint ones are
    // almost all backdrop, so they take the subject colour instead.
    const t = Math.pow(data[i * 4 + 3] / 255, 3)
    for (let c = 0; c < 3; c++) {
      data[i * 4 + c] = Math.round(
        data[i * 4 + c] * t + fill[i * 3 + c] * (1 - t)
      )
    }
  }
}

/** Decode a cutout, refine its edge and encode it again as PNG. */
export async function refineCutoutBlob(
  blob: Blob,
  options?: MatteOptions
): Promise<Blob> {
  const bitmap = await createImageBitmap(blob, {
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
  })
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    bitmap.close()
    throw new Error('Canvas 2D context unavailable')
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close()
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  refineMatte(image.data, image.width, image.height, options)
  ctx.putImageData(image, 0, 0)
  return new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      canvas.width = 0
      canvas.height = 0
      if (result) {
        resolve(result)
      } else {
        reject(new Error('failed'))
      }
    }, 'image/png')
  })
}
