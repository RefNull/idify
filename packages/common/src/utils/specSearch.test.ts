import { afterEach, describe, expect, it, vi } from 'vitest'
import { ID_PHOTO_SPECS } from '../config'
import { IDPhotoSpec } from '../types'
import {
  SpecMatchRank,
  browseSpecs,
  buildSpecIndex,
  describeSpecSize,
  findHighlight,
  getLocalizedRegionName,
  groupEntries,
  normalizeText,
  searchSpecs,
} from './specSearch'

function spec(
  name: string,
  region: string,
  zone: string,
  type: IDPhotoSpec['type'] = 'passport',
  title = `${region} ${type}`
): IDPhotoSpec {
  return {
    name,
    type,
    title,
    region,
    zone,
    flag: '',
    dimension: { width: 413, height: 531, dpi: 300, unit: 'mm' },
    background: '#ffffff',
  }
}

const SAMPLE = [
  spec('finland_passport', 'Finland', 'FI'),
  spec('iran_passport', 'Iran', 'IR'),
  spec('indonesia_visa', 'Indonesia', 'ID', 'visa'),
  spec('india_passport', 'India', 'IN'),
  spec('indonesia_passport', 'Indonesia', 'ID'),
  spec('hong_kong_id', 'Hong Kong', 'HK', 'identification'),
  spec('cote_passport', "Côte d'Ivoire", 'CI'),
  spec('us_visa', 'United States', 'US', 'visa'),
  spec('australia_passport', 'Australia', 'AU'),
  spec('austria_passport', 'Austria', 'AT'),
  spec('eu_generic', 'European Union', '', 'generic'),
  spec('custom_1', 'Global', 'WW', 'custom', 'My India size'),
]

const names = (matches: ReturnType<typeof searchSpecs>) =>
  matches.map((match) => match.entry.spec.name)

describe('normalizeText', () => {
  it('folds case and diacritics', () => {
    expect(normalizeText('  Côte d’Ivoire ')).toBe('cote d’ivoire')
    expect(normalizeText('ÎLE')).toBe('ile')
    expect(normalizeText('São Tomé')).toBe('sao tome')
  })
})

describe('searchSpecs', () => {
  const index = buildSpecIndex(SAMPLE, 'en')

  it('"In" puts India (exact zone) then Indonesia (prefix) first', () => {
    const result = names(searchSpecs(index, 'In'))
    expect(result.slice(0, 3)).toEqual([
      'india_passport',
      'indonesia_visa',
      'indonesia_passport',
    ])
    // Title-contains matches (Finland, the custom spec) come after.
    expect(result).toContain('finland_passport')
    expect(result.indexOf('finland_passport')).toBeGreaterThan(2)
    expect(result).not.toContain('iran_passport')
  })

  it('"Ind" ranks region prefixes by index order', () => {
    const matches = searchSpecs(index, 'ind')
    expect(names(matches).slice(0, 3)).toEqual([
      'indonesia_visa',
      'india_passport',
      'indonesia_passport',
    ])
    expect(matches[0].rank).toBe(SpecMatchRank.RegionPrefix)
  })

  it('matches zone codes exactly and ranks them first', () => {
    const us = searchSpecs(index, 'us')
    expect(us[0].entry.spec.name).toBe('us_visa')
    expect(us[0].rank).toBe(SpecMatchRank.ExactZone)
    const au = searchSpecs(index, 'AU')
    expect(au[0].entry.spec.name).toBe('australia_passport')
    expect(au[0].rank).toBe(SpecMatchRank.ExactZone)
    // "Austria" still matches as a region prefix, after the exact zone.
    expect(names(au)).toContain('austria_passport')
  })

  it('matches word prefixes inside country names', () => {
    const matches = searchSpecs(index, 'Kong')
    expect(names(matches)).toEqual(['hong_kong_id'])
    expect(matches[0].rank).toBe(SpecMatchRank.RegionWordPrefix)
  })

  it('ignores diacritics in both query and data', () => {
    expect(names(searchSpecs(index, 'cote'))).toEqual(['cote_passport'])
    expect(names(searchSpecs(index, 'CÔTE'))).toEqual(['cote_passport'])
  })

  it('combines the text query with the type filter', () => {
    expect(names(searchSpecs(index, 'indo', 'visa'))).toEqual([
      'indonesia_visa',
    ])
    expect(names(searchSpecs(index, 'indo', 'passport'))).toEqual([
      'indonesia_passport',
    ])
    expect(names(searchSpecs(index, 'india', 'custom'))).toEqual(['custom_1'])
    expect(searchSpecs(index, 'kong', 'visa')).toEqual([])
  })

  it('includes custom specs by title', () => {
    expect(names(searchSpecs(index, 'my india'))).toEqual(['custom_1'])
  })

  it('returns nothing for an empty or unmatched query', () => {
    expect(searchSpecs(index, '   ')).toEqual([])
    expect(searchSpecs(index, 'zzzz')).toEqual([])
  })

  it('handles specs without a zone', () => {
    expect(names(searchSpecs(index, 'union'))).toEqual(['eu_generic'])
  })
})

describe('localised country names', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses Intl.DisplayNames for the UI locale', () => {
    expect(getLocalizedRegionName('ID', 'de')).toBe('Indonesien')
    const index = buildSpecIndex(SAMPLE, 'de')
    const matches = searchSpecs(index, 'Indonesien')
    expect(names(matches)).toEqual(['indonesia_visa', 'indonesia_passport'])
    expect(matches[0].rank).toBe(SpecMatchRank.LocalNamePrefix)
    // Group headers use the localised name.
    expect(groupEntries(matches.map((m) => m.entry))[0].title).toBe(
      'Indonesien'
    )
  })

  it('treats unknown or empty codes as unlocalised', () => {
    expect(getLocalizedRegionName('WW', 'en')).toBe('')
    expect(getLocalizedRegionName('', 'en')).toBe('')
    expect(getLocalizedRegionName('ID', 'not a locale!!')).toBe('')
  })

  it('survives Intl.DisplayNames throwing', () => {
    vi.spyOn(Intl, 'DisplayNames').mockImplementation(() => {
      throw new RangeError('boom')
    })
    // A locale not cached yet, so the mock is hit.
    expect(getLocalizedRegionName('ID', 'fr-CA')).toBe('')
    expect(() => buildSpecIndex(SAMPLE, 'fr-CA')).not.toThrow()
  })

  it('works with a mocked DisplayNames', () => {
    vi.spyOn(Intl, 'DisplayNames').mockImplementation(
      () =>
        ({
          of: (code: string) => (code === 'IN' ? 'Bhārat' : code),
        }) as unknown as Intl.DisplayNames
    )
    const index = buildSpecIndex(SAMPLE, 'x-mock')
    expect(names(searchSpecs(index, 'bharat'))).toEqual(['india_passport'])
  })
})

describe('browseSpecs', () => {
  const index = buildSpecIndex(SAMPLE, 'en')

  it('lists recent, suggested, then countries alphabetically, customs last', () => {
    const sections = browseSpecs(index, 'all', {
      recent: ['us_visa', 'missing_spec'],
      suggested: ['us_visa', 'india_passport'],
    })
    expect(sections[0].kind).toBe('recent')
    expect(sections[0].entries.map((e) => e.spec.name)).toEqual(['us_visa'])
    expect(sections[1].kind).toBe('suggested')
    // Already in recent, so not repeated in suggestions.
    expect(sections[1].entries.map((e) => e.spec.name)).toEqual([
      'india_passport',
    ])
    const groups = sections.slice(2)
    const titles = groups.map((s) => s.title)
    expect(titles.slice(0, -1)).toEqual(
      [...titles.slice(0, -1)].sort((a, b) => a.localeCompare(b))
    )
    expect(groups[groups.length - 1].key).toBe('custom')
    // Both Indonesia specs share one country header.
    expect(groups.find((s) => s.title === 'Indonesia')?.entries.length).toBe(2)
  })

  it('applies the type filter to every section', () => {
    const sections = browseSpecs(index, 'visa', {
      recent: ['india_passport', 'us_visa'],
    })
    const all = sections.flatMap((s) => s.entries.map((e) => e.spec.type))
    expect(new Set(all)).toEqual(new Set(['visa']))
    expect(sections[0].entries.map((e) => e.spec.name)).toEqual(['us_visa'])
  })

  it('covers every real spec exactly once in the groups', () => {
    const real = buildSpecIndex(ID_PHOTO_SPECS, 'en')
    const groups = browseSpecs(real, 'all')
    const count = groups.reduce((sum, s) => sum + s.entries.length, 0)
    expect(count).toBe(ID_PHOTO_SPECS.length)
  })
})

describe('real spec data', () => {
  const index = buildSpecIndex(ID_PHOTO_SPECS, 'en')

  it('"In" starts with India then Indonesia', () => {
    const regions = searchSpecs(index, 'In').map((m) => m.entry.spec.region)
    const firstTwo = [...new Set(regions)].slice(0, 2)
    expect(firstTwo).toEqual(['India', 'Indonesia'])
  })

  it('finds Hong Kong by "kong"', () => {
    const regions = new Set(
      searchSpecs(index, 'kong').map((m) => m.entry.spec.region)
    )
    expect(regions.has('Hong Kong')).toBe(true)
  })

  it('searches 544+ specs quickly', () => {
    const start = performance.now()
    for (let i = 0; i < 100; i += 1) {
      searchSpecs(index, i % 2 ? 'in' : 'passport')
    }
    expect((performance.now() - start) / 100).toBeLessThan(10)
  })
})

describe('findHighlight', () => {
  it('maps a diacritic-insensitive match back onto the original text', () => {
    const text = "Côte d'Ivoire Passport"
    const range = findHighlight(text, 'cote')
    expect(range).toEqual({ start: 0, end: 4 })
    expect(text.slice(range!.start, range!.end)).toBe('Côte')
  })

  it('prefers a word-start match', () => {
    const text = 'Finland India'
    const range = findHighlight(text, 'in')!
    expect(text.slice(range.start, range.end)).toBe('In')
    expect(range.start).toBe(8)
  })

  it('falls back to any occurrence and returns null when absent', () => {
    expect(findHighlight('Finland', 'nla')).toEqual({ start: 2, end: 5 })
    expect(findHighlight('Finland', 'xyz')).toBeNull()
    expect(findHighlight('Finland', '')).toBeNull()
  })
})

describe('describeSpecSize', () => {
  it('formats mm and inch specs', () => {
    expect(
      describeSpecSize({ width: 413, height: 531, dpi: 300, unit: 'mm' })
    ).toEqual({ physical: '35×45 mm', pixels: '413×531 px @ 300 dpi' })
    expect(
      describeSpecSize({ width: 600, height: 600, dpi: 300, unit: 'inch' })
    ).toEqual({ physical: '2×2 in', pixels: '600×600 px @ 300 dpi' })
  })
})
