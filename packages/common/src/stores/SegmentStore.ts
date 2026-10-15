import { create } from 'zustand'
import { throttle } from 'lodash-es'
import imglyRemoveBackground from '@zhbhun/background-removal'
import { refineCutoutBlob } from '../utils/matte'

export interface SegmentState {
  image: string
  /** Fail */
  error: Error | null
  /** Segmenting */
  loading: boolean
  progress: number
  /**
   * - 0: idle
   * - 1: downloading
   * - 2: processing
   */
  step: 0 | 1 | 2
  /** Segment result */
  result: string
}

export interface SegmentOptions {
  publicPath?: string
}

export interface SegmentActions {
  process(image: string, options?: SegmentOptions): Promise<string>
  clear(): void
  reset(): void
}

export interface SegmentStore extends SegmentState, SegmentActions {}

export const defaultSegementState: SegmentState = {
  image: '',
  error: null,
  loading: false,
  progress: 0,
  step: 0,
  result: '',
}

/** AI Model already downloaded */
let downloaded = false
let interval: ReturnType<typeof setInterval> | undefined
let onProgress: (key: string, current: number, total: number) => void = () => {}
/** Rejection for a run replaced by a newer image or a reset; safe to ignore. */
export class SegmentSupersededError extends Error {
  name = 'SegmentSupersededError'
  constructor() {
    super('Background removal superseded')
  }
}

/** Incremented per run and on reset, so a superseded run can't touch state. */
let runId = 0

function revokeBlobURL(url: string) {
  if (url && url.startsWith('blob:')) {
    URL.revokeObjectURL(url)
  }
}

export const useSegementStore = create<SegmentStore>((set, get) => ({
  ...defaultSegementState,
  process(image: string, options?: SegmentOptions) {
    get().clear()
    const run = ++runId
    const isCurrent = () => run === runId
    // The previous cutout is only shown while its run is current.
    revokeBlobURL(get().result)
    set({
      ...defaultSegementState,
      image,
      loading: true,
      step: downloaded ? 2 : 1,
    })
    let lastProgress = 0
    let lastDownloadKey = ''
    const startTime = Date.now()
    onProgress = throttle((key: string, current: number, total: number) => {
      if (!isCurrent() || !get().loading) {
        return
      }
      if (!downloaded) {
        if (key !== lastDownloadKey && lastDownloadKey) {
          lastProgress += Math.floor(100 * (1 / 6))
        }
        set({
          progress:
            lastProgress + Math.floor(100 * (current / total) * (1 / 6)),
        })
        lastDownloadKey = key
      }
      if (key === 'compute:inference') {
        downloaded = true
        set({
          step: 2,
        })
        if (current === 1) {
          if (interval) {
            clearInterval(interval)
            interval = undefined
          }
        } else if (!interval) {
          interval = setInterval(() => {
            if (get().loading) {
              set({
                progress: Math.min(
                  lastProgress +
                    (100 - lastProgress) *
                      ((Date.now() - startTime) / (30 * 1000)),
                  99
                ),
              })
            } else {
              get().clear()
            }
          }, 1000)
        }
      }
    }, 1000)
    return imglyRemoveBackground(image, {
      progress: (key: string, current: number, total: number) => {
        onProgress(key, current, total)
      },
      ...options,
    })
      .then((blob) =>
        // Narrow the soft edge and remove the old backdrop's colour from it;
        // fall back to the raw cutout if the browser can't decode it here.
        isCurrent() ? refineCutoutBlob(blob).catch(() => blob) : blob
      )
      .then((blob) => {
        const url = URL.createObjectURL(blob)
        if (!isCurrent()) {
          // Superseded by a newer image or a reset: drop this result.
          URL.revokeObjectURL(url)
          throw new SegmentSupersededError()
        }
        set({
          error: null,
          loading: false,
          result: url,
        })
        return url
      })
      .catch((error) => {
        if (!isCurrent() || error instanceof SegmentSupersededError) {
          throw error
        }
        set({
          error,
          loading: false,
        })
        throw error
      })
  },
  clear() {
    if (interval) {
      clearInterval(interval)
      interval = undefined
    }
  },
  reset() {
    get().clear()
    runId += 1
    revokeBlobURL(get().result)
    set(defaultSegementState)
  },
}))
