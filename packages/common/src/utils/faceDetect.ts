/**
 * On-device face detection with YuNet (OpenCV Zoo, MIT licence; see
 * assets/models/LICENSE-yunet), run by onnxruntime-web on the same wasm
 * runtime files that background removal already ships. Nothing is fetched
 * from anywhere but the app's own origin.
 */

/** YuNet's fixed input size. */
export const YUNET_SIZE = 640
const STRIDES = [8, 16, 32] as const

export interface DetectedFace {
  /** Face box (roughly brows to chin), in fractions of the image size. */
  x: number
  y: number
  width: number
  height: number
  score: number
  /** Right eye, left eye, nose tip, right and left mouth corners. */
  landmarks: [number, number][]
}

export type YuNetOutputs = Record<string, Float32Array>

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1)

/**
 * Decode YuNet's raw outputs (in input pixels) into faces above `threshold`,
 * largest first. Mirrors OpenCV's FaceDetectorYN post-processing.
 */
export function decodeYuNet(
  outputs: YuNetOutputs,
  size = YUNET_SIZE,
  threshold = 0.6
) {
  const faces: DetectedFace[] = []
  for (const stride of STRIDES) {
    const cls = outputs[`cls_${stride}`]
    const obj = outputs[`obj_${stride}`]
    const bbox = outputs[`bbox_${stride}`]
    const kps = outputs[`kps_${stride}`]
    if (!cls || !obj || !bbox || !kps) continue
    const cols = Math.floor(size / stride)
    const rows = Math.floor(size / stride)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c
        const score = Math.sqrt(clamp01(cls[i]) * clamp01(obj[i]))
        if (score < threshold) continue
        const cx = (c + bbox[i * 4]) * stride
        const cy = (r + bbox[i * 4 + 1]) * stride
        const w = Math.exp(bbox[i * 4 + 2]) * stride
        const h = Math.exp(bbox[i * 4 + 3]) * stride
        const landmarks: [number, number][] = []
        for (let n = 0; n < 5; n++) {
          landmarks.push([
            (kps[i * 10 + n * 2] + c) * stride,
            (kps[i * 10 + n * 2 + 1] + r) * stride,
          ])
        }
        faces.push({
          x: cx - w / 2,
          y: cy - h / 2,
          width: w,
          height: h,
          score,
          landmarks,
        })
      }
    }
  }
  return pickFaces(faces)
}

function iou(a: DetectedFace, b: DetectedFace) {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.width, b.x + b.width)
  const y2 = Math.min(a.y + a.height, b.y + b.height)
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const union = a.width * a.height + b.width * b.height - inter
  return union > 0 ? inter / union : 0
}

/** Non-maximum suppression, then largest face first. */
function pickFaces(faces: DetectedFace[]) {
  const sorted = [...faces].sort((a, b) => b.score - a.score)
  const kept: DetectedFace[] = []
  for (const face of sorted) {
    if (kept.every((other) => iou(face, other) < 0.3)) kept.push(face)
  }
  return kept.sort((a, b) => b.width * b.height - a.width * a.height)
}

/** Where an image sits inside the square, letterboxed model input. */
export function letterbox(width: number, height: number, size = YUNET_SIZE) {
  const scale = size / Math.max(width, height)
  return {
    scale,
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  }
}

/** Map a face from model-input pixels to fractions of the source image. */
export function toImageFraction(
  face: DetectedFace,
  box: { width: number; height: number }
): DetectedFace {
  return {
    x: face.x / box.width,
    y: face.y / box.height,
    width: face.width / box.width,
    height: face.height / box.height,
    score: face.score,
    landmarks: face.landmarks.map(([x, y]) => [x / box.width, y / box.height]),
  }
}

// Same files as @zhbhun/background-removal's bundled onnxruntime-web 1.16.1
// (byte-identical to the npm package's ort-wasm-simd.wasm / ort-wasm.wasm).
const ORT_WASM_FILES = {
  'ort-wasm-simd.wasm': 'dc2a12575e932a5bd879.wasm',
  'ort-wasm.wasm': 'f5f426e8db26d19f310d.wasm',
}

type OrtModule = typeof import('onnxruntime-web')
type Session = import('onnxruntime-web').InferenceSession
let sessionPromise: Promise<{ ort: OrtModule; session: Session }> | null = null

function loadSession(publicPath: string) {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const [ort, model] = await Promise.all([
        import('onnxruntime-web'),
        import('../assets/models/face_detection_yunet_2023mar.onnx?url'),
      ])
      const base = publicPath.endsWith('/') ? publicPath : `${publicPath}/`
      ort.env.wasm.numThreads = 1
      ort.env.wasm.proxy = false
      ort.env.wasm.wasmPaths = {
        'ort-wasm-simd.wasm': base + ORT_WASM_FILES['ort-wasm-simd.wasm'],
        'ort-wasm.wasm': base + ORT_WASM_FILES['ort-wasm.wasm'],
      }
      const session = await ort.InferenceSession.create(model.default, {
        executionProviders: ['wasm'],
      })
      return { ort, session }
    })()
    sessionPromise.catch(() => {
      sessionPromise = null
    })
  }
  return sessionPromise
}

/** Detect the largest face in an image URL, or null if none is found. */
export async function detectFace(
  url: string,
  publicPath = '/assets/background-removal/'
): Promise<DetectedFace | null> {
  const blob = await fetch(url).then((response) => response.blob())
  const bitmap = await createImageBitmap(blob)
  const box = letterbox(bitmap.width, bitmap.height)
  const canvas = document.createElement('canvas')
  canvas.width = YUNET_SIZE
  canvas.height = YUNET_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    bitmap.close()
    return null
  }
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, YUNET_SIZE, YUNET_SIZE)
  ctx.drawImage(bitmap, 0, 0, box.width, box.height)
  bitmap.close()
  const { data } = ctx.getImageData(0, 0, YUNET_SIZE, YUNET_SIZE)
  const plane = YUNET_SIZE * YUNET_SIZE
  // BGR, 0-255, planar (NCHW).
  const input = new Float32Array(plane * 3)
  for (let i = 0; i < plane; i++) {
    input[i] = data[i * 4 + 2]
    input[plane + i] = data[i * 4 + 1]
    input[plane * 2 + i] = data[i * 4]
  }
  const { ort, session } = await loadSession(publicPath)
  const results = await session.run({
    input: new ort.Tensor('float32', input, [1, 3, YUNET_SIZE, YUNET_SIZE]),
  })
  const outputs: YuNetOutputs = {}
  for (const [name, tensor] of Object.entries(results)) {
    outputs[name] = tensor.data as Float32Array
  }
  const [face] = decodeYuNet(outputs)
  return face ? toImageFraction(face, box) : null
}
