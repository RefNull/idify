import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { InferenceSession } from 'onnxruntime-node'

export const YUNET_FILE = 'face_detection_yunet_2023mar.onnx'

/** packages/mcp, from both src/engine and the bundled dist/index.js. */
export function packageDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url))
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return dir
}

/**
 * The face model: dist/models (copied there by the build), or the web app's
 * copy in this monorepo when running from src in tests.
 */
export function yunetModelPath(): string {
  const pkg = packageDir()
  const candidates = [
    path.join(pkg, 'dist/models', YUNET_FILE),
    path.join(pkg, '../common/src/assets/models', YUNET_FILE),
  ]
  const found = candidates.find((p) => fs.existsSync(p))
  if (!found) throw new Error(`Face model not found (looked in ${candidates.join(', ')})`)
  return found
}

/**
 * The web app's background-removal model ("imgly_medium" in
 * @zhbhun/background-removal 1.0.8), shipped as hashed chunks that are
 * concatenated in this order.
 */
export const SEGMENT_MODEL_CHUNKS = [
  'de5e30866b768519d918.onnx',
  '70a406e9df771cc6bc67.onnx',
  'c63207475d21d6991f15.onnx',
  'bb9ee4f182db91d43876.onnx',
  'dec0c66a4dbb37487da1.onnx',
  '6aeccb4c06aad7f8e4de.onnx',
  '0a733bd9ce54fc470425.onnx',
  'acce14f7ccd4d32b66d3.onnx',
  '79810ed8b56c5a0082a2.onnx',
]
export const SEGMENT_MODEL_SIZE = 88188479
export const SEGMENT_INPUT_SIZE = 1024

export function segmentModelChunks(): string[] {
  const require = createRequire(import.meta.url)
  const pkg = require.resolve('@zhbhun/background-removal/package.json')
  return SEGMENT_MODEL_CHUNKS.map((file) => path.join(path.dirname(pkg), 'dist', file))
}

type Ort = typeof import('onnxruntime-node')
let ortPromise: Promise<Ort> | null = null

export function loadOrt(): Promise<Ort> {
  ortPromise ??= import('onnxruntime-node').catch((err) => {
    ortPromise = null
    throw new Error(
      `onnxruntime-node failed to load on ${process.platform}/${process.arch}: ${err instanceof Error ? err.message : String(err)}`
    )
  })
  return ortPromise
}

const sessions = new Map<string, Promise<InferenceSession>>()

/** One cached session per model; a failed load is retried next time. */
export function loadSession(
  key: string,
  load: () => Promise<Uint8Array | string>
): Promise<InferenceSession> {
  let session = sessions.get(key)
  if (!session) {
    session = (async () => {
      const ort = await loadOrt()
      const model = await load()
      return typeof model === 'string'
        ? ort.InferenceSession.create(model)
        : ort.InferenceSession.create(model)
    })()
    session.catch(() => sessions.delete(key))
    sessions.set(key, session)
  }
  return session
}

export function faceSession(): Promise<InferenceSession> {
  return loadSession('yunet', async () => yunetModelPath())
}

export function segmentSession(): Promise<InferenceSession> {
  return loadSession('segment', async () => {
    const chunks = segmentModelChunks()
    const missing = chunks.find((p) => !fs.existsSync(p))
    if (missing) throw new Error(`Background-removal model chunk missing: ${missing}`)
    const model = Buffer.concat(chunks.map((p) => fs.readFileSync(p)))
    if (model.length !== SEGMENT_MODEL_SIZE) {
      throw new Error('Background-removal model has an unexpected size')
    }
    return new Uint8Array(model.buffer, model.byteOffset, model.length)
  })
}
