/**
 * Quick search over ID photo specs for the spec picker. Pure: no React or DOM,
 * only `Intl.DisplayNames` for localised country names.
 *
 * Every spec is indexed once with pre-normalised strings; a search is then a
 * plain filter + sort over ~550 entries, which is far below a frame budget.
 */
import { IDPhotoSpec, IDPhotoType } from '../types'

/** Type filter chips in display order. `all` disables type filtering. */
export const SPEC_TYPE_FILTERS = [
  'all',
  'passport',
  'visa',
  'identification',
  'driving',
  'student',
  'generic',
  'others',
  'custom',
] as const

export type SpecTypeFilter = (typeof SPEC_TYPE_FILTERS)[number]

/** Match quality, best first. Lower is better. */
export enum SpecMatchRank {
  ExactZone = 0,
  RegionPrefix = 1,
  RegionWordPrefix = 2,
  LocalNamePrefix = 3,
  TitleContains = 4,
}

/** Lower-case, strip diacritics (NFD) and trim. "Île " -> "ile". */
export function normalizeText(text: string) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
}

function words(text: string) {
  return text.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

const displayNamesCache = new Map<string, Intl.DisplayNames | null>()

/**
 * The country name for a 2-letter zone in `locale`, e.g. ("ID", "de") ->
 * "Indonesien". Empty when the locale or code is unknown.
 */
export function getLocalizedRegionName(zone: string, locale: string) {
  if (!zone || !locale) {
    return ''
  }
  let displayNames = displayNamesCache.get(locale)
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames([locale], { type: 'region' })
    } catch (error) {
      displayNames = null
    }
    displayNamesCache.set(locale, displayNames)
  }
  if (!displayNames) {
    return ''
  }
  try {
    const name = displayNames.of(zone.toUpperCase())
    // Unknown codes come back as the code itself (e.g. "WW").
    return name && name.toUpperCase() !== zone.toUpperCase() ? name : ''
  } catch (error) {
    return ''
  }
}

export interface SpecIndexEntry {
  spec: IDPhotoSpec
  /** Position in the input list; keeps ties in a stable order. */
  order: number
  /** Group key: one header per country (customs get their own). */
  groupKey: string
  /** Country name to show: localised when available. */
  groupName: string
  zone: string
  region: string
  regionWords: string[]
  localName: string
  localWords: string[]
  title: string
}

export const CUSTOM_GROUP_KEY = 'custom'

function groupKeyOf(spec: IDPhotoSpec) {
  if (spec.type === 'custom') {
    return CUSTOM_GROUP_KEY
  }
  return spec.zone ? `zone:${spec.zone.toUpperCase()}` : `region:${spec.region}`
}

/** Pre-normalise every spec for searching. Build once per spec list + locale. */
export function buildSpecIndex(
  specs: IDPhotoSpec[],
  locale = 'en'
): SpecIndexEntry[] {
  return specs.map((spec, order) => {
    const localName =
      spec.type === 'custom' ? '' : getLocalizedRegionName(spec.zone, locale)
    const region = normalizeText(spec.region || '')
    const local = normalizeText(localName)
    return {
      spec,
      order,
      groupKey: groupKeyOf(spec),
      groupName: localName || spec.region,
      zone: (spec.zone || '').toUpperCase(),
      region,
      regionWords: words(region),
      localName: local,
      localWords: words(local),
      title: normalizeText(spec.title || ''),
    }
  })
}

/** How well `entry` matches the normalised query, or null for no match. */
export function rankEntry(
  entry: SpecIndexEntry,
  query: string
): SpecMatchRank | null {
  if (!query) {
    return null
  }
  if (entry.spec.type !== 'custom' && query.length === 2 && entry.zone) {
    if (entry.zone === query.toUpperCase()) {
      return SpecMatchRank.ExactZone
    }
  }
  if (entry.region.startsWith(query)) {
    return SpecMatchRank.RegionPrefix
  }
  if (entry.regionWords.some((word) => word.startsWith(query))) {
    return SpecMatchRank.RegionWordPrefix
  }
  if (
    entry.localName &&
    (entry.localName.startsWith(query) ||
      entry.localWords.some((word) => word.startsWith(query)))
  ) {
    return SpecMatchRank.LocalNamePrefix
  }
  if (entry.title.includes(query)) {
    return SpecMatchRank.TitleContains
  }
  return null
}

export function matchesTypeFilter(spec: IDPhotoSpec, filter: SpecTypeFilter) {
  return filter === 'all' || spec.type === (filter as IDPhotoType)
}

export interface SpecMatch {
  entry: SpecIndexEntry
  rank: SpecMatchRank
}

/**
 * Entries matching `query` and the type filter, best match first, stable in
 * index order within a rank. An empty query matches nothing; use
 * {@link browseSpecs} to list everything.
 */
export function searchSpecs(
  index: SpecIndexEntry[],
  query: string,
  filter: SpecTypeFilter = 'all'
): SpecMatch[] {
  const normalized = normalizeText(query)
  if (!normalized) {
    return []
  }
  const matches: SpecMatch[] = []
  for (const entry of index) {
    if (!matchesTypeFilter(entry.spec, filter)) {
      continue
    }
    const rank = rankEntry(entry, normalized)
    if (rank !== null) {
      matches.push({ entry, rank })
    }
  }
  return matches.sort(
    (a, b) => a.rank - b.rank || a.entry.order - b.entry.order
  )
}

export interface SpecSection {
  /** Unique key: `recent`, `suggested`, or a country group key. */
  key: string
  kind: 'recent' | 'suggested' | 'group'
  /** Country name for groups; empty for recent/suggested (labelled by the UI). */
  title: string
  flag: string
  zone: string
  entries: SpecIndexEntry[]
}

/**
 * Group ranked entries under country headers. Groups appear in the order of
 * their best entry, so the best-matching country comes first.
 */
export function groupEntries(entries: SpecIndexEntry[]): SpecSection[] {
  const sections = new Map<string, SpecSection>()
  for (const entry of entries) {
    let section = sections.get(entry.groupKey)
    if (!section) {
      section = {
        key: entry.groupKey,
        kind: 'group',
        title: entry.spec.type === 'custom' ? '' : entry.groupName,
        flag: entry.spec.type === 'custom' ? '' : entry.spec.flag,
        zone: entry.spec.type === 'custom' ? '' : entry.zone,
        entries: [],
      }
      sections.set(entry.groupKey, section)
    }
    section.entries.push(entry)
  }
  return [...sections.values()]
}

export interface BrowseOptions {
  /** Recently picked spec names, newest first. */
  recent?: string[]
  /** Spec names suggested for the user's locale. */
  suggested?: string[]
  locale?: string
}

/**
 * The picker contents for an empty query: recent picks, locale suggestions,
 * then every spec grouped by country in alphabetical order (custom specs
 * last). All sections respect the type filter.
 */
export function browseSpecs(
  index: SpecIndexEntry[],
  filter: SpecTypeFilter = 'all',
  { recent = [], suggested = [], locale = 'en' }: BrowseOptions = {}
): SpecSection[] {
  const visible = index.filter((entry) => matchesTypeFilter(entry.spec, filter))
  const byName = new Map(visible.map((entry) => [entry.spec.name, entry]))
  const pick = (names: string[]) =>
    names
      .map((name) => byName.get(name))
      .filter((entry): entry is SpecIndexEntry => Boolean(entry))
  const sections: SpecSection[] = []
  const recentEntries = pick(recent)
  if (recentEntries.length) {
    sections.push({
      key: 'recent',
      kind: 'recent',
      title: '',
      flag: '',
      zone: '',
      entries: recentEntries,
    })
  }
  const recentNames = new Set(recentEntries.map((entry) => entry.spec.name))
  const suggestedEntries = pick(suggested).filter(
    (entry) => !recentNames.has(entry.spec.name)
  )
  if (suggestedEntries.length) {
    sections.push({
      key: 'suggested',
      kind: 'suggested',
      title: '',
      flag: '',
      zone: '',
      entries: suggestedEntries,
    })
  }
  let collator: Intl.Collator
  try {
    collator = new Intl.Collator(locale, { sensitivity: 'base' })
  } catch (error) {
    collator = new Intl.Collator('en', { sensitivity: 'base' })
  }
  const groups = groupEntries(visible).sort((a, b) => {
    if (a.key === CUSTOM_GROUP_KEY || b.key === CUSTOM_GROUP_KEY) {
      return a.key === CUSTOM_GROUP_KEY
        ? 1
        : b.key === CUSTOM_GROUP_KEY
          ? -1
          : 0
    }
    return collator.compare(a.title, b.title)
  })
  return [...sections, ...groups]
}

/**
 * Where to highlight `query` in `text`, in `text`'s own indices, matching the
 * same way search does (case- and diacritic-insensitive). Prefers a match at
 * the start of a word. Null when absent.
 */
export function findHighlight(
  text: string,
  query: string
): { start: number; end: number } | null {
  const needle = normalizeText(query)
  if (!needle || !text) {
    return null
  }
  // Normalise character by character, remembering where each normalised
  // character came from, so the range maps back onto the original text.
  let haystack = ''
  const origin: number[] = []
  let offset = 0
  for (const char of text) {
    const normalized = char.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    for (let i = 0; i < normalized.length; i += 1) {
      origin.push(offset)
    }
    haystack += normalized
    offset += char.length
  }
  origin.push(offset)
  let at = -1
  let from = haystack.indexOf(needle)
  while (from >= 0) {
    if (from === 0 || !/[\p{L}\p{N}]/u.test(haystack[from - 1])) {
      at = from
      break
    }
    if (at < 0) {
      at = from
    }
    from = haystack.indexOf(needle, from + 1)
  }
  if (at < 0) {
    return null
  }
  const start = origin[at]
  // End at the start of the next original character after the match.
  let end = origin[at + needle.length]
  if (end === undefined) {
    end = text.length
  }
  return { start, end }
}

/** Human-readable size of a spec: physical size and pixels at dpi. */
export function describeSpecSize(dimension: IDPhotoSpec['dimension']) {
  const { width, height, dpi, unit } = dimension
  const perUnit = { mm: dpi / 25.4, cm: dpi / 2.54, inch: dpi }[unit] || dpi
  const round = (value: number) => Number((value / perUnit).toFixed(1))
  const unitLabel = unit === 'inch' ? 'in' : unit
  return {
    physical: `${round(width)}×${round(height)} ${unitLabel}`,
    pixels: `${width}×${height} px @ ${dpi} dpi`,
  }
}
