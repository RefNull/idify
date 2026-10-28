import { create } from 'zustand'
import { mixOriginalBackground } from '../utils/image'

export type RetouchBackgroundGradientAngle =
  | 'l'
  | 'r'
  | 't'
  | 'b'
  | 'c'
  | 'tl'
  | 'tr'
  | 'bl'
  | 'br'

export interface RetouchBackgroundGradient {
  angle: RetouchBackgroundGradientAngle
  brightness: number
}

export interface RetouchBackground {
  color: string
  gradient: RetouchBackgroundGradient
}

export interface RetouchAdjustment {
  /**
   * Provides additive brightness control.
   *
   * -1 to 1 (-1 is solid black, 0 is no change, and 1 is solid white)
   */
  brightness?: number
  /**
   * Provides additive multiplicative contrast control.
   *
   * -1 to 1 (-1 is solid gray, 0 is no change, and 1 is maximum contrast)
   */
  contrast?: number
  /**
   * Saturation is implemented by scaling all color channel values either toward or away from the average color channel value.
   *
   * -1 to 1 (-1 is solid gray, 0 is no change, and 1 is maximum contrast)
   */
  saturation?: number
  /**
   * Adds black and white noise to the image.
   *
   * 0 to 1 (0 for no effect, 1 for maximum noise)
   */
  noise?: number
  /**
   * Gives the image a reddish-brown monochrome tint that imitates an old photograph.
   *
   * 0 to 1 (0 for no effect, 1 for full sepia coloring)
   */
  sepia?: number
  /**
   * Modifies the saturation of desaturated colors, leaving saturated colors unmodified.
   *
   * -1 to 1 (-1 is minimum vibrance, 0 is no change, and 1 is maximum vibrance)
   */
  vibrance?: number
  /** Adds a simulated lens edge darkening effect. */
  vignette?: {
    /** 0 to 1 (0 for center of frame, 1 for edge of frame) */
    size: number
    /** 0 to 1 (0 for no effect, 1 for maximum lens darkening) */
    amount: number
  }
}

export interface RetouchState {
  /** The photo being retouched: the cutout, with `removal` applied. */
  image: string
  /** The cropped cutout, before any of the original is blended back. */
  cutout: string
  /** The same crop of the original photo; empty when there is no cutout. */
  original: string
  /**
   * How much of the original background is removed, 0 to 1. Below 1 the
   * original shows through at `1 - removal` opacity.
   */
  removal: number
  background: RetouchBackground
  adjustment: RetouchAdjustment
  /** Show the head-position guides over the preview. */
  guides: boolean
}

export interface RetouchActions {
  setImage(image: string, original?: string): void
  setRemoval(removal: number): void
  setBackground(background: RetouchBackground): void
  setAdjustment(adjustment: RetouchAdjustment): void
  toggleGuides(): void
  reset(): void
}

export interface RetouchStore extends RetouchState, RetouchActions {}

export const defaultRetouchState: RetouchState = {
  image: '',
  cutout: '',
  original: '',
  removal: 1,
  background: {
    color: '#ffffff',
    gradient: {
      angle: 'c',
      brightness: 0,
    },
  },
  adjustment: {},
  guides: false,
}

/** The cropped photo is a blob URL owned by this store; free it when replaced. */
function revokeBlobURL(url: string) {
  if (url && url.startsWith('blob:')) {
    URL.revokeObjectURL(url)
  }
}

/** Every blob URL the store owns (the blended image is separate from the cutout). */
function revokeAll({ image, cutout, original }: RetouchState) {
  for (const url of new Set([image, cutout, original])) {
    revokeBlobURL(url)
  }
}

/** Bumped per image and on reset, so a stale blend is thrown away. */
let mixRun = 0
/** Blending is slow on big photos: run one at a time, latest value wins. */
let mixing = false

export const useRetouchStore = create<RetouchStore>((set, get) => ({
  ...defaultRetouchState,
  setImage(image: string, original = '') {
    const previous = get()
    if (previous.image !== image || previous.original !== original) {
      revokeAll(previous)
    }
    mixRun++
    // Keep the guide toggle across images; it is a view preference.
    set({
      ...defaultRetouchState,
      image,
      cutout: image,
      original,
      guides: get().guides,
    })
  },
  setRemoval(removal: number) {
    set({ removal })
    if (mixing) {
      return
    }
    const run = mixRun
    mixing = true
    const apply = async () => {
      try {
        // Re-read after each blend: the slider may have moved meanwhile.
        for (;;) {
          const { cutout, original, removal: wanted } = get()
          const url =
            original && wanted < 1
              ? await mixOriginalBackground(cutout, original, wanted)
              : cutout
          if (run !== mixRun) {
            if (url !== cutout) revokeBlobURL(url)
            return
          }
          const { image: previous } = get()
          if (previous !== cutout && previous !== url) revokeBlobURL(previous)
          set({ image: url })
          if (get().removal === wanted) return
        }
      } finally {
        mixing = false
        // A new image arrived mid-blend and its slider moved: blend it now.
        if (run !== mixRun && get().original && get().removal < 1) {
          get().setRemoval(get().removal)
        }
      }
    }
    apply().catch(() => {
      // Keep the last good blend.
    })
  },
  setBackground(background: RetouchBackground) {
    set({ background })
  },
  setAdjustment(adjustment: RetouchAdjustment) {
    set({ adjustment: { ...get().adjustment, ...adjustment } })
  },
  toggleGuides() {
    set({ guides: !get().guides })
  },
  reset() {
    revokeAll(get())
    mixRun++
    set(defaultRetouchState)
  },
}))
