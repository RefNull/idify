import { create } from 'zustand'
import { ID_PHOTO_SPECS } from '../config'
import { IDPhotoSpec } from '../types'

export interface CropState {
  image: string
  useOriginalBackground: boolean
  position: { x: number; y: number }
  flipHorizontal: boolean
  flipVertical: boolean
  rotation: number
  zoom: number
  /** The user has moved, zoomed or rotated the crop: stop auto-framing. */
  touched: boolean
  area: {
    width: number
    height: number
    x: number
    y: number
  }
}

export interface CropActions {
  setImage(image: string): void
  setUseOriginalBackground(useOriginal: boolean): void
  setPosition(position: CropState['position']): void
  setFlipHorizontal(flipHorizontal: boolean): void
  setFlipVertical(flipVertical: boolean): void
  setRotation(
    rotation:
      | CropState['rotation']
      | ((rotation: CropState['rotation']) => CropState['rotation'])
  ): void
  setZoom(
    zoom: CropState['zoom'] | ((zoom: CropState['zoom']) => CropState['zoom'])
  ): void
  setArea(area: CropState['area']): void
  /** Mark the crop as adjusted by the user. */
  touch(): void
  /** Apply an automatic framing, unless the user has adjusted the crop. */
  autoFrame(position: CropState['position'], zoom: number): void
  reset(): void
}

export interface CropStore extends CropState, CropActions {}

export const defaultCropState: CropState = {
  image: '',
  useOriginalBackground: false,
  position: {
    x: 0,
    y: 0,
  },
  flipHorizontal: false,
  flipVertical: false,
  rotation: 0,
  zoom: 1,
  touched: false,
  area: {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  },
}

export const useCropStore = create<CropStore>((set, get) => ({
  ...defaultCropState,
  setImage(image: string) {
    set({ ...defaultCropState, image })
  },
  setUseOriginalBackground(useOriginalBackground: boolean) {
    set({ useOriginalBackground })
  },
  setPosition(position) {
    set({ position })
  },
  setFlipHorizontal(flipHorizontal: boolean) {
    set({ flipHorizontal })
  },
  setFlipVertical(flipVertical: boolean) {
    set({ flipVertical })
  },
  setRotation(rotation) {
    set({ touched: true })
    if (typeof rotation === 'function') {
      set({ rotation: rotation(get().rotation) })
    } else {
      set({ rotation })
    }
  },
  setZoom(zoom) {
    set({ touched: true })
    if (typeof zoom === 'function') {
      set({ zoom: zoom(get().zoom) })
    } else {
      set({ zoom })
    }
  },
  setArea(area) {
    set({ area })
  },
  touch() {
    set({ touched: true })
  },
  autoFrame(position, zoom) {
    if (!get().touched) {
      set({ position, zoom })
    }
  },
  reset() {
    set(defaultCropState)
  },
}))
