import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ID_PHOTO_SPECS, ID_PHOTO_GENERIC_SPECS } from '../config'
import { IDPhotoSpec } from '../types'
import { getRegion } from '../utils/intl'
import {
  PersistedSpecState,
  SPEC_STORE_VERSION,
  buildSpecGroups,
  getNextCustomName,
  migrateSpecState,
  pushRecent,
  resolveSpec,
} from './specState'

export * from './specState'

export interface SpecState {
  customs: IDPhotoSpec[]
  /** Specs for the user's region. Rebuilt at runtime, never persisted. */
  localeSpecs: IDPhotoSpec[]
  /** Recently picked spec names, newest first. */
  recent: string[]
  spec: string
}

export interface SpecAction {
  initiate(): Promise<void>
  setSpec(spec: string): void
  addCustom(spec: IDPhotoSpec): void
  updateCustom(spec: IDPhotoSpec): void
  removeCustom(spec: IDPhotoSpec): void
  getNextName(): string
}

export interface SpecStore extends SpecState, SpecAction {}

export const defaultSpecState: SpecState = {
  spec: ID_PHOTO_GENERIC_SPECS[0].name,
  localeSpecs: [],
  recent: [],
  customs: [],
}

export const useSpecStore = create(
  persist<SpecStore, [], [], PersistedSpecState>(
    (set, get) => ({
      ...defaultSpecState,
      async initiate() {
        let region = ''
        try {
          region = await getRegion()
        } catch (error) {
          // No region: the picker simply has no locale suggestions.
        }
        if (!region) {
          return
        }
        const localeSpecs = ID_PHOTO_SPECS.filter(
          (spec) => spec.zone === region
        )
        if (localeSpecs.length === 0) {
          return
        }
        const { spec, recent } = get()
        // Only preselect a local spec until the user has picked one.
        const untouched = recent.length === 0 && spec === defaultSpecState.spec
        set({
          localeSpecs,
          ...(untouched ? { spec: localeSpecs[0].name } : {}),
        })
      },
      setSpec(spec) {
        set({ spec, recent: pushRecent(get().recent, spec) })
      },
      addCustom(spec) {
        set((prevState) => ({
          customs: [spec, ...prevState.customs],
        }))
      },
      updateCustom(spec: IDPhotoSpec): void {
        set((prevState) => ({
          customs: prevState.customs.map((item) =>
            item.name === spec.name ? { ...item, ...spec } : item
          ),
        }))
      },
      removeCustom(spec) {
        set((prevState) => ({
          customs: prevState.customs.filter((item) => item.name !== spec.name),
          recent: prevState.recent.filter((item) => item !== spec.name),
        }))
      },
      getNextName() {
        return getNextCustomName(get().customs)
      },
    }),
    {
      name: 'idify_spec',
      version: SPEC_STORE_VERSION,
      migrate: migrateSpecState,
      partialize: (state) => ({
        spec: state.spec,
        customs: state.customs,
        recent: state.recent,
      }),
    }
  )
)

export function useSpecGroups() {
  const localeSpecs = useSpecStore((state) => state.localeSpecs)
  const customs = useSpecStore((state) => state.customs)
  return useMemo(
    () => buildSpecGroups(localeSpecs, customs),
    [localeSpecs, customs]
  )
}

export function getSelectedSpec() {
  const { customs, localeSpecs, spec } = useSpecStore.getState()
  return resolveSpec(spec, customs, localeSpecs)
}

export function useSelectedSpec() {
  const customs = useSpecStore((state) => state.customs)
  const localeSpecs = useSpecStore((state) => state.localeSpecs)
  const selected = useSpecStore((state) => state.spec)
  const setSpec = useSpecStore((state) => state.setSpec)
  const spec = useMemo(
    () => resolveSpec(selected, customs, localeSpecs),
    [selected, customs, localeSpecs]
  )
  return [
    spec,
    (newSpec: IDPhotoSpec) => {
      setSpec(newSpec.name)
    },
  ] as [IDPhotoSpec, (spec: IDPhotoSpec) => void]
}
