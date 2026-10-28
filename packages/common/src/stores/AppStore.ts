import { create } from 'zustand'
import { useCropStore, useSegementStore, useSpecStore } from '.'
import { useRetouchStore } from './RetouchStore'

export interface AppState {
  /**
   * - 0: select photo
   * - 1: crop photo
   * - 2：edit photo
   */
  step: 0 | 1 | 2
}

export interface AppActions {
  initiate(): void;
  crop(image: string): void
  /** `original`: the same crop of the unedited photo, when `image` is a cutout. */
  retouch(image: string, original?: string): void
  cancel(): void
  reset(): void
}

export const defaultAppState: AppState = {
  step: 0,
}

export interface AppStore extends AppState, AppActions {}

export const useAppStore = create<AppStore>((set, get) => ({
  ...defaultAppState,
  initiate() {
    useSpecStore.getState().initiate();
  },
  crop(image: string) {
    useCropStore.getState().setImage(image)
    set({ step: 1 })
  },
  retouch(image: string, original?: string) {
    useRetouchStore.getState().setImage(image, original)
    set({ step: 2 })
  },
  cancel() {
    set({ step: Math.max(0, get().step - 1) as AppState['step'] })
  },
  reset() {
    useCropStore.getState().reset()
    useSegementStore.getState().reset()
    useRetouchStore.getState().reset()
    set({ step: 0 })
  },
}))
