/**
 * Pure helpers behind SpecStore: naming, validation, persistence migration and
 * spec lookup. No React, zustand or DOM, so they can be unit-tested in Node.
 */
import {
  CUSTOM_SPEC_LIMITS,
  CUSTOM_SPEC_UNIT,
  ID_PHOTO_GENERIC_SPECS,
  ID_PHOTO_GROUPS,
  ID_PHOTO_SPECS,
} from '../config'
import { IDPhotoGroup, IDPhotoSpec } from '../types'

/** Bump when the persisted shape changes, and handle the old shape in migrate. */
export const SPEC_STORE_VERSION = 1

/** How many recently picked specs the picker remembers. */
export const RECENT_SPEC_LIMIT = 5

export interface PersistedSpecState {
  spec: string
  customs: IDPhotoSpec[]
  recent: string[]
}

const CUSTOM_NAME_PATTERN = /^custom_(\d+)$/

function customId(name: string) {
  const match = CUSTOM_NAME_PATTERN.exec(name)
  return match ? Number(match[1]) : -1
}

/** The next free `custom_N` name: one more than the largest N in use. */
export function getNextCustomName(customs: Pick<IDPhotoSpec, 'name'>[]) {
  let maxId = 0
  for (const custom of customs) {
    const id = customId(custom.name)
    if (id > maxId) {
      maxId = id
    }
  }
  return `custom_${maxId + 1}`
}

/** Move `name` to the front of the recent list, without duplicates. */
export function pushRecent(
  recent: string[],
  name: string,
  limit = RECENT_SPEC_LIMIT
) {
  return [name, ...recent.filter((item) => item !== name)].slice(0, limit)
}

export interface CustomSpecForm {
  name: string
  width: string | number
  height: string | number
  dpi: string | number
}

export type CustomSpecError =
  | 'customNameRequired'
  | 'customWidthInvalid'
  | 'customHeightInvalid'
  | 'customDpiInvalid'

export type CustomSpecValidation =
  | {
      ok: true
      value: { title: string; width: number; height: number; dpi: number }
    }
  | { ok: false; field: keyof CustomSpecForm; error: CustomSpecError }

function toNumber(value: string | number) {
  if (typeof value === 'string' && value.trim() === '') {
    return NaN
  }
  return Number(value)
}

function inRange(value: number, min: number, max: number) {
  return Number.isFinite(value) && value >= min && value <= max
}

/**
 * Validate the custom spec form. Dimensions are pixels and must be whole
 * numbers; the error ids are locale message ids.
 */
export function validateCustomSpecForm(
  form: CustomSpecForm
): CustomSpecValidation {
  const title = form.name.trim()
  if (!title) {
    return { ok: false, field: 'name', error: 'customNameRequired' }
  }
  const { minSize, maxSize, minDpi, maxDpi } = CUSTOM_SPEC_LIMITS
  const width = toNumber(form.width)
  if (!inRange(width, minSize, maxSize) || !Number.isInteger(width)) {
    return { ok: false, field: 'width', error: 'customWidthInvalid' }
  }
  const height = toNumber(form.height)
  if (!inRange(height, minSize, maxSize) || !Number.isInteger(height)) {
    return { ok: false, field: 'height', error: 'customHeightInvalid' }
  }
  const dpi = toNumber(form.dpi)
  if (!inRange(dpi, minDpi, maxDpi)) {
    return { ok: false, field: 'dpi', error: 'customDpiInvalid' }
  }
  return { ok: true, value: { title, width, height, dpi } }
}

/** Build a custom spec from validated form values. */
export function createCustomSpec(
  name: string,
  value: { title: string; width: number; height: number; dpi: number },
  base?: IDPhotoSpec
): IDPhotoSpec {
  return {
    region: 'Global',
    zone: 'WW',
    flag: '',
    background: '#ffffff',
    ...base,
    name,
    type: 'custom',
    title: value.title,
    dimension: {
      width: value.width,
      height: value.height,
      dpi: value.dpi,
      unit: CUSTOM_SPEC_UNIT,
    },
  }
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number
) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return fallback
  }
  return Math.min(max, Math.max(min, Math.round(number)))
}

/** Coerce a persisted custom spec (older versions stored strings) to a valid one. */
function normaliseCustom(custom: any): IDPhotoSpec | null {
  if (
    !custom ||
    typeof custom !== 'object' ||
    typeof custom.name !== 'string'
  ) {
    return null
  }
  const { minSize, maxSize, minDpi, maxDpi } = CUSTOM_SPEC_LIMITS
  const dimension = custom.dimension || {}
  return {
    region: 'Global',
    zone: 'WW',
    flag: '',
    background: '#ffffff',
    ...custom,
    type: 'custom',
    title: String(custom.title ?? custom.name),
    dimension: {
      width: clampNumber(dimension.width, minSize, maxSize, 300),
      height: clampNumber(dimension.height, minSize, maxSize, 300),
      dpi: clampNumber(dimension.dpi, minDpi, maxDpi, 300),
      unit: CUSTOM_SPEC_UNIT,
    },
  }
}

/**
 * Upgrade persisted state from any older version:
 * - drop the persisted `groups` (stale copies of spec.json),
 * - coerce custom dimensions to numbers within the custom limits,
 * - rename custom specs whose names collide (the old name generator reused
 *   `custom_0`), keeping the first occurrence's name.
 */
export function migrateSpecState(
  persisted: unknown,
  _version: number
): PersistedSpecState {
  const state = (
    persisted && typeof persisted === 'object' ? persisted : {}
  ) as Record<string, unknown>
  const rawCustoms = Array.isArray(state.customs) ? state.customs : []
  const customs: IDPhotoSpec[] = []
  const seen = new Set<string>()
  for (const raw of rawCustoms) {
    const custom = normaliseCustom(raw)
    if (!custom) {
      continue
    }
    if (seen.has(custom.name)) {
      custom.name = getNextCustomName([
        ...customs,
        ...rawCustoms.filter(
          (item: any) => item && typeof item.name === 'string'
        ),
      ])
    }
    seen.add(custom.name)
    customs.push(custom)
  }
  const spec =
    typeof state.spec === 'string' && state.spec
      ? state.spec
      : ID_PHOTO_GENERIC_SPECS[0].name
  const recent = Array.isArray(state.recent)
    ? state.recent
        .filter((item): item is string => typeof item === 'string')
        .slice(0, RECENT_SPEC_LIMIT)
    : []
  return { spec, customs, recent }
}

const SPEC_BY_NAME = new Map(ID_PHOTO_SPECS.map((spec) => [spec.name, spec]))

/** Find a spec by name among built-ins and customs. */
export function findSpec(name: string, customs: IDPhotoSpec[]) {
  return SPEC_BY_NAME.get(name) || customs.find((item) => item.name === name)
}

/**
 * The spec that `name` refers to, falling back to the first locale suggestion
 * and then to the first generic spec when it no longer exists.
 */
export function resolveSpec(
  name: string,
  customs: IDPhotoSpec[],
  localeSpecs: IDPhotoSpec[] = []
): IDPhotoSpec {
  return findSpec(name, customs) || localeSpecs[0] || ID_PHOTO_GENERIC_SPECS[0]
}

/** Picker groups: locale suggestions, every built-in type, then customs. */
export function buildSpecGroups(
  localeSpecs: IDPhotoSpec[],
  customs: IDPhotoSpec[]
): IDPhotoGroup[] {
  return [
    ...(localeSpecs.length
      ? [{ name: 'locale', title: 'Locale', specs: localeSpecs }]
      : []),
    ...ID_PHOTO_GROUPS,
    { name: 'custom', title: 'Custom', specs: customs },
  ]
}
