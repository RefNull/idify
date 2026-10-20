import path from 'node:path'
import type sharpType from 'sharp'
import {
  YUNET_SIZE,
  decodeYuNet,
  letterbox,
  toImageFraction,
} from '../../../common/src/utils/faceDetect.js'
import type { DetectedFace, YuNetOutputs } from '../../../common/src/utils/faceDetect.js'
import { getHeadBox } from '../../../common/src/utils/autoFrame.js'
import type { HeadBox, MaskData } from '../../../common/src/utils/autoFrame.js'
import { refineMatte } from '../../../common/src/utils/matte.js'
import { EYE_IN_HEAD, solveCrown } from '../../../common/src/utils/placement.js'
import { SEGMENT_INPUT_SIZE, faceSession, loadOrt, segmentSession } from './models.js'
import type {
  ComplianceResult,
  ProcessPhotoOptions,
  ProcessPhotoResult,
  RenderSheetOptions,
  RenderSheetResult,
  VisionEngine,
} from './types.js'

/**
 * Cross-platform engine: the web app's face detector (YuNet), its
 * background-removal model and its framing and edge-cleanup code, run with
 * onnxruntime-node, with sharp for image decoding and encoding.
 */

type Sharp = typeof sharpType
let sharpPromise: Promise<Sharp> | null = null

function loadSharp(): Promise<Sharp> {
  sharpPromise ??= import('sharp')
    .then((m) => m.default)
    .catch((err) => {
      sharpPromise = null
      throw new Error(
        `sharp failed to load on ${process.platform}/${process.arch}: ${err instanceof Error ? err.message : String(err)}`
      )
    })
  return sharpPromise
}

interface RgbaImage {
  data: Buffer
  width: number
  height: number
}

/** Decode to RGBA, applying the EXIF orientation. */
async function readImage(file: string): Promise<RgbaImage> {
  const sharp = await loadSharp()
  const { data, info } = await sharp(file)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

function rawInput(image: RgbaImage) {
  return { raw: { width: image.width, height: image.height, channels: 4 as const } }
}

const isJpeg = (file: string) => /\.jpe?g$/i.test(path.extname(file))

async function writeImage(
  pipeline: sharpType.Sharp,
  file: string,
  dpi: number
): Promise<void> {
  const out = pipeline.withMetadata({ density: dpi })
  if (isJpeg(file)) {
    await out.flatten({ background: '#ffffff' }).jpeg({ quality: 95 }).toFile(file)
  } else {
    await out.png().toFile(file)
  }
}

interface Region {
  left: number
  top: number
  width: number
  height: number
}

/** Faces in a region of the image, largest first, in fractions of the image. */
async function runYuNet(image: RgbaImage, region: Region): Promise<DetectedFace[]> {
  const sharp = await loadSharp()
  const box = letterbox(region.width, region.height)
  const { data } = await sharp(image.data, rawInput(image))
    .extract(region)
    .removeAlpha()
    .resize(box.width, box.height, { fit: 'fill' })
    .extend({
      right: YUNET_SIZE - box.width,
      bottom: YUNET_SIZE - box.height,
      background: '#000000',
    })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const plane = YUNET_SIZE * YUNET_SIZE
  // BGR, 0-255, planar (NCHW).
  const input = new Float32Array(plane * 3)
  for (let i = 0; i < plane; i++) {
    input[i] = data[i * 3 + 2]
    input[plane + i] = data[i * 3 + 1]
    input[plane * 2 + i] = data[i * 3]
  }
  const [ort, session] = await Promise.all([loadOrt(), faceSession()])
  const results = await session.run({
    input: new ort.Tensor('float32', input, [1, 3, YUNET_SIZE, YUNET_SIZE]),
  })
  const outputs: YuNetOutputs = {}
  for (const [name, tensor] of Object.entries(results)) {
    outputs[name] = tensor.data as Float32Array
  }
  const toImage = (x: number, y: number): [number, number] => [
    (region.left + x * region.width) / image.width,
    (region.top + y * region.height) / image.height,
  ]
  return decodeYuNet(outputs).map((face) => {
    const f = toImageFraction(face, box)
    const [x, y] = toImage(f.x, f.y)
    return {
      ...f,
      x,
      y,
      width: (f.width * region.width) / image.width,
      height: (f.height * region.height) / image.height,
      landmarks: f.landmarks.map(([lx, ly]) => toImage(lx, ly)),
    }
  })
}

/** Below this width in detector pixels a face's landmarks are coarse. */
const SMALL_FACE = 160

/**
 * All faces, largest first, in fractions of the image size. A face that is
 * small in the full frame is detected again in a close crop, so its landmarks
 * (and so roll, yaw and the eye line) are measured at a usable resolution.
 */
async function detectFaces(image: RgbaImage): Promise<DetectedFace[]> {
  const { width, height } = image
  const faces = await runYuNet(image, { left: 0, top: 0, width, height })
  const face = faces[0]
  const scale = YUNET_SIZE / Math.max(width, height)
  if (!face || face.width * width * scale >= SMALL_FACE) return faces

  const side = Math.min(
    Math.max(face.width * width, face.height * height) * 3,
    width,
    height
  )
  const cx = (face.x + face.width / 2) * width
  const cy = (face.y + face.height / 2) * height
  const region = {
    left: Math.round(Math.min(Math.max(cx - side / 2, 0), width - side)),
    top: Math.round(Math.min(Math.max(cy - side / 2, 0), height - side)),
    width: Math.round(side),
    height: Math.round(side),
  }
  const [closer] = await runYuNet(image, region)
  return closer ? [closer, ...faces.slice(1)] : faces
}

/** Person alpha mask (0-255) at the image's size, as the web app computes it. */
async function segmentPerson(image: RgbaImage): Promise<Uint8Array> {
  const sharp = await loadSharp()
  const size = SEGMENT_INPUT_SIZE
  const { data } = await sharp(image.data, rawInput(image))
    .removeAlpha()
    .resize(size, size, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const plane = size * size
  const input = new Float32Array(plane * 3)
  for (let i = 0; i < plane; i++) {
    input[i] = (data[i * 3] - 128) / 256
    input[plane + i] = (data[i * 3 + 1] - 128) / 256
    input[plane * 2 + i] = (data[i * 3 + 2] - 128) / 256
  }
  const [ort, session] = await Promise.all([loadOrt(), segmentSession()])
  const results = await session.run({
    [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, size, size]),
  })
  const output = results[session.outputNames[0]].data as Float32Array
  const small = Buffer.alloc(plane)
  for (let i = 0; i < plane; i++) {
    small[i] = Math.round(Math.min(Math.max(output[i], 0), 1) * 255)
  }
  const { data: mask } = await sharp(small, { raw: { width: size, height: size, channels: 1 } })
    .resize(image.width, image.height, { fit: 'fill' })
    .extractChannel(0)
    .raw()
    .toBuffer({ resolveWithObject: true })
  return mask
}

/** A downscaled RGBA copy of the mask for crown finding. */
async function maskData(mask: Uint8Array, image: RgbaImage, maxSide = 480): Promise<MaskData> {
  const sharp = await loadSharp()
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const { data: small } = await sharp(Buffer.from(mask.buffer, mask.byteOffset, mask.length), {
    raw: { width: image.width, height: image.height, channels: 1 },
  })
    .resize(width, height, { fit: 'fill' })
    .extractChannel(0)
    .raw()
    .toBuffer({ resolveWithObject: true })
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i++) data[i * 4 + 3] = small[i]
  return { data, width, height }
}

/** Head pose from the five landmarks: roll is measured, yaw estimated. */
export function estimatePose(face: DetectedFace, width: number, height: number) {
  const [rightEye, leftEye, nose] = face.landmarks.map(([x, y]) => [x * width, y * height])
  const dx = leftEye[0] - rightEye[0]
  const dy = leftEye[1] - rightEye[1]
  const roll = (Math.atan2(dy, dx) * 180) / Math.PI
  // Undo the roll, then compare the nose tip's offset from the eyes' midpoint
  // with half the eye distance. On a generic head the nose tip sits about
  // 0.8 half-eye-distances in front of the eyes.
  const midX = (rightEye[0] + leftEye[0]) / 2
  const midY = (rightEye[1] + leftEye[1]) / 2
  const angle = Math.atan2(dy, dx)
  const offset = (nose[0] - midX) * Math.cos(angle) + (nose[1] - midY) * Math.sin(angle)
  const half = Math.hypot(dx, dy) / 2
  const yaw = half > 0 ? (Math.atan(offset / half / 0.8) * 180) / Math.PI : 0
  return { roll, yaw }
}

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places

/** Yaw here is an estimate, so only a clear turn is flagged. */
const MAX_YAW = 8

function parseHex(hex: string): [number, number, number, number] | null {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) : 255]
}

/** The cutout (cleaned like the web app's) over a solid colour, in place. */
function replaceBackground(
  image: RgbaImage,
  mask: Uint8Array,
  [br, bg, bb, ba]: [number, number, number, number]
) {
  const { data, width, height } = image
  for (let i = 0; i < width * height; i++) {
    data[i * 4 + 3] = mask[i]
    if (mask[i] === 0) {
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 0
    }
  }
  refineMatte(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    width,
    height
  )
  const back = [br, bg, bb]
  const backA = ba / 255
  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3] / 255
    const outA = a + backA * (1 - a)
    for (let c = 0; c < 3; c++) {
      data[i * 4 + c] =
        outA > 0 ? Math.round((data[i * 4 + c] * a + back[c] * backA * (1 - a)) / outA) : 0
    }
    data[i * 4 + 3] = Math.round(outA * 255)
  }
}

export class OnnxEngine implements VisionEngine {
  async inspect(imagePath: string): Promise<ComplianceResult> {
    const image = await readImage(imagePath)
    const faces = await detectFaces(image)
    const face = faces[0]
    if (!face) {
      return {
        faceDetected: false,
        faceCount: 0,
        rollDegrees: 0,
        yawDegrees: null,
        pitchDegrees: null,
        qualityScore: null,
        chinYNormalized: 0,
        crownYNormalized: 0,
        eyeLevelNormalized: 0,
        headHeightRatio: 0,
        isCentered: false,
        compliant: false,
        violations: ['No face detected in photo'],
        advisories: [],
        engineUsed: 'onnx',
      }
    }

    const advisories: string[] = []
    let mask: MaskData | null = null
    try {
      mask = await maskData(await segmentPerson(image), image)
    } catch (err) {
      advisories.push(
        `Background removal was unavailable, so the top of the head was estimated from the face (${err instanceof Error ? err.message : String(err)})`
      )
    }
    const head = getHeadBox(face, mask)
    const { roll, yaw } = estimatePose(face, image.width, image.height)
    const isCentered = Math.abs(head.centerX - 0.5) <= 0.08

    const violations: string[] = []
    if (faces.length > 1) {
      violations.push(`Multiple faces detected (${faces.length}); measured the largest`)
    }
    if (Math.abs(roll) > 3) {
      violations.push(`Head tilt / roll exceeds ±3° (${roll.toFixed(1)}°)`)
    }
    if (Math.abs(yaw) > MAX_YAW) {
      violations.push(`Head appears turned (yaw about ${yaw.toFixed(0)}°)`)
    }
    if (!isCentered) {
      violations.push(
        `Face is not centered horizontally (center at ${(head.centerX * 100).toFixed(1)}%)`
      )
    }
    advisories.push(
      'Yaw is estimated from facial landmarks; head pitch and capture quality are not measured by this engine.'
    )

    return {
      faceDetected: true,
      faceCount: faces.length,
      rollDegrees: round(roll, 1),
      yawDegrees: round(yaw, 1),
      pitchDegrees: null,
      qualityScore: null,
      chinYNormalized: round(head.bottom, 3),
      crownYNormalized: round(head.top, 3),
      eyeLevelNormalized: round(head.eyes ?? 0, 3),
      headHeightRatio: round(head.bottom - head.top, 3),
      isCentered,
      compliant: violations.length === 0,
      violations,
      advisories,
      engineUsed: 'onnx',
    }
  }

  async process(options: ProcessPhotoOptions): Promise<ProcessPhotoResult> {
    const sharp = await loadSharp()
    const image = await readImage(options.inputPath)
    const { width: imgW, height: imgH } = image
    if (imgW <= 10 || imgH <= 10) throw new Error('Invalid image dimensions')

    let background: [number, number, number, number] | null = null
    if (options.bgColorHex !== 'none') {
      background = parseHex(options.bgColorHex)
      if (!background) {
        throw new Error('Invalid background colour; expected #RRGGBB, #RRGGBBAA or none')
      }
    }

    const notes: string[] = []
    let mask: Uint8Array | null = null
    if (background || options.autoFrame) {
      try {
        mask = await segmentPerson(image)
      } catch (err) {
        if (background) {
          notes.push(
            `Person segmentation failed; the original background was kept (${err instanceof Error ? err.message : String(err)})`
          )
        }
      }
    }

    let head: HeadBox | null = null
    if (options.autoFrame) {
      const [face] = await detectFaces(image)
      if (face) {
        head = getHeadBox(face, mask ? await maskData(mask, image) : null)
      } else {
        notes.push('No face detected; auto-frame was skipped and the photo was centre-cropped')
      }
    }

    const bgReplaced = Boolean(background && mask)
    if (background && mask) replaceBackground(image, mask, background)

    const aspect = options.targetWidth / options.targetHeight
    let rect: { x: number; y: number; width: number; height: number }
    if (head) {
      const ratio = Math.min(Math.max(options.targetHeadRatio, 0.2), 0.95)
      const headPx = Math.max(50, (head.bottom - head.top) * imgH)
      let height = headPx / ratio
      const eyeInHead =
        head.eyes !== undefined && head.bottom > head.top
          ? (head.eyes - head.top) / (head.bottom - head.top)
          : EYE_IN_HEAD
      const crown = options.placementRules
        ? solveCrown(options.placementRules, ratio, eyeInHead).crown
        : options.targetTopMargin
      const top = (h: number) => head!.top * imgH - crown * h
      if (!bgReplaced) {
        // Original background: stay inside the photo.
        height = Math.min(height, imgH, imgW / aspect)
      }
      const width = height * aspect
      let x = head.centerX * imgW - width / 2
      let y = top(height)
      if (!bgReplaced) {
        x = Math.max(0, Math.min(imgW - width, x))
        y = Math.max(0, Math.min(imgH - height, y))
      }
      rect = { x, y, width, height }
    } else {
      // Centre crop to the target aspect.
      const height = Math.min(imgH, imgW / aspect)
      const width = height * aspect
      rect = { x: (imgW - width) / 2, y: (imgH - height) / 2, width, height }
    }

    // Integer crop; with a new background the frame may run past the photo
    // and is padded with that colour.
    const left = Math.round(rect.x)
    const top = Math.round(rect.y)
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    const pad = {
      left: Math.max(0, -left),
      top: Math.max(0, -top),
      right: Math.max(0, left + width - imgW),
      bottom: Math.max(0, top + height - imgH),
    }
    let source = sharp(image.data, rawInput(image))
    if (pad.left || pad.top || pad.right || pad.bottom) {
      const [r, g, b, a] = background ?? [255, 255, 255, 255]
      const padded = await source
        .extend({ ...pad, background: { r, g, b, alpha: a / 255 } })
        .raw()
        .toBuffer({ resolveWithObject: true })
      source = sharp(padded.data, {
        raw: { width: padded.info.width, height: padded.info.height, channels: 4 },
      })
    }
    const output = source
      .extract({ left: left + pad.left, top: top + pad.top, width, height })
      .resize(options.targetWidth, options.targetHeight, { fit: 'fill' })
    await writeImage(output, options.outputPath, options.dpi)

    return {
      success: true,
      outputPath: options.outputPath,
      width: options.targetWidth,
      height: options.targetHeight,
      dpi: options.dpi,
      backgroundReplaced: bgReplaced,
      engineUsed: 'onnx',
      message: notes.length ? notes.join('; ') : null,
    }
  }

  async renderSheet(options: RenderSheetOptions): Promise<RenderSheetResult> {
    const sharp = await loadSharp()
    const { sheetWidthPx: width, sheetHeightPx: height } = options
    if (!(width > 0 && height > 0 && width <= 20000 && height <= 20000)) {
      throw new Error('Invalid sheet dimensions')
    }
    const cells = options.cells.map((c) => ({
      x: Math.round(c.x),
      y: Math.round(c.y),
      width: Math.round(c.width),
      height: Math.round(c.height),
    }))
    if (cells.length === 0) throw new Error('No cells to draw')
    for (const c of cells) {
      if (c.width <= 0 || c.height <= 0 || c.x < 0 || c.y < 0 || c.x + c.width > width || c.y + c.height > height) {
        throw new Error('Cell lies outside the sheet')
      }
    }

    // White sheet with a one-pixel grey hairline just outside each photo.
    const sheet = Buffer.alloc(width * height * 3, 255)
    if (options.cutGuides) {
      const dot = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return
        sheet.fill(153, (y * width + x) * 3, (y * width + x) * 3 + 3)
      }
      for (const c of cells) {
        for (let x = c.x - 1; x <= c.x + c.width; x++) {
          dot(x, c.y - 1)
          dot(x, c.y + c.height)
        }
        for (let y = c.y - 1; y <= c.y + c.height; y++) {
          dot(c.x - 1, y)
          dot(c.x + c.width, y)
        }
      }
    }

    // Aspect-fill each cell, centre-cropping a photo whose aspect differs.
    const tiles = new Map<string, Buffer>()
    for (const c of cells) {
      const key = `${c.width}x${c.height}`
      if (!tiles.has(key)) {
        tiles.set(
          key,
          await sharp(options.photoPath)
            .rotate()
            .removeAlpha()
            .resize(c.width, c.height, { fit: 'cover', position: 'centre' })
            .png()
            .toBuffer()
        )
      }
    }
    const output = sharp(sheet, { raw: { width, height, channels: 3 } }).composite(
      cells.map((c) => ({ input: tiles.get(`${c.width}x${c.height}`)!, left: c.x, top: c.y }))
    )
    await writeImage(output, options.outputPath, options.dpi)

    return {
      success: true,
      outputPath: options.outputPath,
      width,
      height,
      dpi: options.dpi,
      cellCount: cells.length,
      engineUsed: 'onnx',
      message: null,
    }
  }
}
