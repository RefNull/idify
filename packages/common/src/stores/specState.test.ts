import { describe, expect, it } from 'vitest'
import { ID_PHOTO_GENERIC_SPECS, ID_PHOTO_SPECS } from '../config'
import { IDPhotoSpec } from '../types'
import {
  buildSpecGroups,
  createCustomSpec,
  getNextCustomName,
  migrateSpecState,
  pushRecent,
  resolveSpec,
  validateCustomSpecForm,
} from './specState'

const custom = (name: string, extra: Partial<IDPhotoSpec> = {}) =>
  createCustomSpec(
    name,
    { title: name, width: 300, height: 400, dpi: 300 },
    {
      ...(extra as IDPhotoSpec),
    }
  )

describe('getNextCustomName', () => {
  it('returns custom_{max + 1}', () => {
    expect(getNextCustomName([])).toBe('custom_1')
    expect(getNextCustomName([custom('custom_0')])).toBe('custom_1')
    expect(getNextCustomName([custom('custom_3'), custom('custom_1')])).toBe(
      'custom_4'
    )
  })

  it('never repeats a name across successive adds', () => {
    const customs: IDPhotoSpec[] = []
    for (let i = 0; i < 5; i += 1) {
      customs.unshift(custom(getNextCustomName(customs)))
    }
    expect(new Set(customs.map((c) => c.name)).size).toBe(5)
  })

  it('ignores names that are not custom_N', () => {
    expect(getNextCustomName([custom('weird'), custom('custom_x')])).toBe(
      'custom_1'
    )
  })
})

describe('validateCustomSpecForm', () => {
  const valid = { name: ' Mine ', width: '300', height: 400, dpi: '300' }

  it('stores numbers, not strings, and trims the name', () => {
    const result = validateCustomSpecForm(valid)
    expect(result).toEqual({
      ok: true,
      value: { title: 'Mine', width: 300, height: 400, dpi: 300 },
    })
  })

  it.each([
    [{ name: '  ' }, 'name', 'customNameRequired'],
    [{ width: '0' }, 'width', 'customWidthInvalid'],
    [{ width: '' }, 'width', 'customWidthInvalid'],
    [{ width: 'abc' }, 'width', 'customWidthInvalid'],
    [{ width: '10001' }, 'width', 'customWidthInvalid'],
    [{ width: '12.5' }, 'width', 'customWidthInvalid'],
    [{ height: '-5' }, 'height', 'customHeightInvalid'],
    [{ height: 'Infinity' }, 'height', 'customHeightInvalid'],
    [{ dpi: '71' }, 'dpi', 'customDpiInvalid'],
    [{ dpi: '1201' }, 'dpi', 'customDpiInvalid'],
  ])('rejects %o', (patch, field, error) => {
    expect(validateCustomSpecForm({ ...valid, ...patch })).toEqual({
      ok: false,
      field,
      error,
    })
  })

  it('accepts the bounds', () => {
    expect(
      validateCustomSpecForm({ name: 'a', width: 1, height: 10000, dpi: 72 }).ok
    ).toBe(true)
    expect(
      validateCustomSpecForm({ name: 'a', width: 1, height: 1, dpi: 1200 }).ok
    ).toBe(true)
  })
})

describe('createCustomSpec', () => {
  it('always uses the mm unit and custom type, keeping the base fields', () => {
    const base = custom('custom_2', { background: '#000000' })
    const spec = createCustomSpec(
      'custom_2',
      { title: 'New', width: 10, height: 20, dpi: 96 },
      base
    )
    expect(spec).toMatchObject({
      name: 'custom_2',
      type: 'custom',
      title: 'New',
      background: '#000000',
      dimension: { width: 10, height: 20, dpi: 96, unit: 'mm' },
    })
  })
})

describe('migrateSpecState', () => {
  it('drops groups, coerces strings and renames duplicates', () => {
    const legacy = {
      spec: 'custom_0',
      groups: [{ name: 'passport', title: 'Passport', specs: [] }],
      customs: [
        {
          name: 'custom_0',
          type: 'custom',
          title: 'First',
          dimension: { width: '300', height: '400', dpi: '300', unit: 'cm' },
        },
        {
          name: 'custom_0',
          type: 'custom',
          title: 'Second',
          dimension: { width: '0', height: '99999', dpi: 'x' },
        },
        {
          name: 'custom_0',
          title: 'Third',
          dimension: { width: 50, height: 60, dpi: 600 },
        },
        null,
        { title: 'no name' },
      ],
    }
    const migrated = migrateSpecState(legacy, 0)
    expect(migrated).not.toHaveProperty('groups')
    expect(migrated.spec).toBe('custom_0')
    expect(migrated.recent).toEqual([])
    expect(migrated.customs.map((c) => c.name)).toEqual([
      'custom_0',
      'custom_1',
      'custom_2',
    ])
    expect(migrated.customs.map((c) => c.title)).toEqual([
      'First',
      'Second',
      'Third',
    ])
    expect(migrated.customs[0].dimension).toEqual({
      width: 300,
      height: 400,
      dpi: 300,
      unit: 'mm',
    })
    // Out-of-range values are clamped; garbage falls back to 300 dpi.
    expect(migrated.customs[1].dimension).toEqual({
      width: 1,
      height: 10000,
      dpi: 300,
      unit: 'mm',
    })
    for (const c of migrated.customs) {
      expect(typeof c.dimension.width).toBe('number')
      expect(c.type).toBe('custom')
    }
  })

  it('handles empty or junk persisted state', () => {
    for (const junk of [undefined, null, 'x', 42, {}]) {
      expect(migrateSpecState(junk, 0)).toEqual({
        spec: ID_PHOTO_GENERIC_SPECS[0].name,
        customs: [],
        recent: [],
      })
    }
  })

  it('keeps a valid recent list', () => {
    expect(
      migrateSpecState({ recent: ['a', 1, 'b', 'c', 'd', 'e', 'f'] }, 1).recent
    ).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('pushRecent', () => {
  it('moves to the front, dedupes and caps', () => {
    expect(pushRecent(['a', 'b', 'c'], 'b')).toEqual(['b', 'a', 'c'])
    expect(pushRecent(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual([
      'f',
      'a',
      'b',
      'c',
      'd',
    ])
  })
})

describe('resolveSpec', () => {
  it('finds built-ins and customs, and falls back sensibly', () => {
    const builtIn = ID_PHOTO_SPECS[10]
    expect(resolveSpec(builtIn.name, [])).toBe(builtIn)
    const mine = custom('custom_1')
    expect(resolveSpec('custom_1', [mine])).toBe(mine)
    expect(resolveSpec('gone', [], [builtIn])).toBe(builtIn)
    expect(resolveSpec('gone', [])).toBe(ID_PHOTO_GENERIC_SPECS[0])
  })
})

describe('buildSpecGroups', () => {
  it('includes locale, every type and customs, so nothing is unreachable', () => {
    const mine = custom('custom_1')
    const groups = buildSpecGroups([ID_PHOTO_SPECS[0]], [mine])
    expect(groups.map((g) => g.name)).toEqual([
      'locale',
      'passport',
      'visa',
      'identification',
      'driving',
      'student',
      'generic',
      'others',
      'custom',
    ])
    const reachable = new Set(
      groups.slice(1).flatMap((g) => g.specs.map((s) => s.name))
    )
    for (const spec of ID_PHOTO_SPECS) {
      expect(reachable.has(spec.name)).toBe(true)
    }
    expect(buildSpecGroups([], [])[0].name).toBe('passport')
  })
})
