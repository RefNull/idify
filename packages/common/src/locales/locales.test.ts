import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// @formatjs/icu-messageformat-parser is only a transitive dependency (via react-intl) and does not
// resolve from this package, so messages are checked with a small ICU MessageFormat scanner instead.
// It handles apostrophe quoting, simple/typed arguments and plural/select/selectordinal blocks.

interface Parsed {
  args: Set<string>
}

const PLURAL_CATEGORIES = new Set(['zero', 'one', 'two', 'few', 'many', 'other'])

const parseMessage = (message: string): Parsed => {
  const args = new Set<string>()
  let i = 0

  const fail = (reason: string): never => {
    throw new Error(`${reason} at offset ${i} in ${JSON.stringify(message)}`)
  }
  const skipSpace = () => {
    while (i < message.length && /\s/.test(message[i])) i++
  }
  const readIdentifier = () => {
    const match = /^[^\s{}#,'=]+/.exec(message.slice(i))
    if (!match) fail('expected identifier')
    i += match![0].length
    return match![0]
  }

  // Parses text until an unmatched '}' (or end of input when top level).
  const parseBody = (inPlural: boolean, topLevel: boolean) => {
    while (i < message.length) {
      const ch = message[i]
      if (ch === "'") {
        const next = message[i + 1]
        if (next === "'") {
          i += 2
        } else if (next === '{' || next === '}' || (inPlural && next === '#')) {
          const end = message.indexOf("'", i + 1)
          if (end === -1) fail('unterminated quote')
          i = end + 1
        } else {
          i++
        }
      } else if (ch === '{') {
        i++
        parseArgument()
      } else if (ch === '}') {
        if (topLevel) fail('unmatched }')
        return
      } else {
        i++
      }
    }
    if (!topLevel) fail('unterminated block')
  }

  const parseArgument = () => {
    skipSpace()
    const name = readIdentifier()
    args.add(name)
    skipSpace()
    if (message[i] === '}') {
      i++
      return
    }
    if (message[i] !== ',') fail('expected , or }')
    i++
    skipSpace()
    const type = readIdentifier()
    skipSpace()
    if (type === 'plural' || type === 'selectordinal' || type === 'select') {
      if (message[i] !== ',') fail(`expected , after ${type}`)
      i++
      skipSpace()
      if (type !== 'select' && message.startsWith('offset:', i)) {
        i += 'offset:'.length
        skipSpace()
        readIdentifier()
        skipSpace()
      }
      const selectors = new Set<string>()
      while (message[i] !== '}') {
        if (i >= message.length) fail('unterminated options')
        let selector: string
        if (type !== 'select' && message[i] === '=') {
          i++
          selector = `=${readIdentifier()}`
          if (!/^=\d+$/.test(selector)) fail(`invalid exact selector ${selector}`)
        } else {
          selector = readIdentifier()
          if (type !== 'select' && !PLURAL_CATEGORIES.has(selector)) {
            fail(`invalid plural category ${selector}`)
          }
        }
        if (selectors.has(selector)) fail(`duplicate selector ${selector}`)
        selectors.add(selector)
        skipSpace()
        if (message[i] !== '{') fail('expected {')
        i++
        parseBody(type !== 'select', false)
        i++ // closing }
        skipSpace()
      }
      if (!selectors.has('other')) fail(`${type} without other`)
      i++
      return
    }
    // number/date/time with optional style
    if (message[i] === ',') {
      const end = message.indexOf('}', i)
      if (end === -1) fail('unterminated argument')
      i = end
    }
    if (message[i] !== '}') fail('expected }')
    i++
  }

  parseBody(false, true)
  return { args }
}

const dir = __dirname
const load = (file: string): Record<string, string> =>
  JSON.parse(readFileSync(join(dir, file), 'utf8'))

const en = load('en.json')
const enKeys = Object.keys(en).sort()
const locales = readdirSync(dir)
  .filter((file) => file.endsWith('.json') && file !== 'en.json')
  .sort()

describe('ICU scanner', () => {
  it('extracts arguments and rejects malformed messages', () => {
    expect([...parseMessage('{a} x {b, number} {c, plural, =0 {none} one {# {d}} other {#}}').args]).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
    expect([...parseMessage("it's '{literal}' here").args]).toEqual([])
    expect(() => parseMessage('{a')).toThrow()
    expect(() => parseMessage('a}')).toThrow()
    expect(() => parseMessage('{n, plural, one {x}}')).toThrow(/without other/)
    expect(() => parseMessage('{n, plural, single {x} other {y}}')).toThrow(/category/)
  })
})

describe('en.json', () => {
  it.each(Object.keys(en))('%s parses', (key) => {
    expect(() => parseMessage(en[key])).not.toThrow()
  })
})

describe.each(locales)('%s', (file) => {
  const messages = load(file)

  it('has exactly the keys of en.json', () => {
    expect(Object.keys(messages).sort()).toEqual(enKeys)
  })

  it.each(Object.keys(en))('%s parses and uses the same arguments as en', (key) => {
    const message = messages[key]
    expect(typeof message).toBe('string')
    const { args } = parseMessage(message)
    expect([...args].sort()).toEqual([...parseMessage(en[key]).args].sort())
  })
})
