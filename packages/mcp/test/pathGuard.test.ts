import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  IMAGE_EXTENSIONS,
  MANIFEST_EXTENSIONS,
  PathGuardError,
  assertImageFile,
  ensureParentDir,
  getAllowedRoot,
  resolveSafePath,
} from '../src/pathGuard.js'
import { JPEG_BYTES, PNG_BYTES, makeRoot, writeFile } from './helpers.js'

let root: string
let outside: string

beforeEach(() => {
  root = makeRoot()
  outside = makeRoot()
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})

const read = (p: string) =>
  resolveSafePath(p, { label: 'image_path', mode: 'read', extensions: IMAGE_EXTENSIONS, root })
const write = (p: string, overwrite = false) =>
  resolveSafePath(p, {
    label: 'output_path',
    mode: 'write',
    extensions: IMAGE_EXTENSIONS,
    overwrite,
    root,
  })

describe('getAllowedRoot', () => {
  it('uses IDIFY_MCP_ROOT when set, resolved through realpath', () => {
    expect(getAllowedRoot({ IDIFY_MCP_ROOT: root })).toBe(root)
  })
  it('falls back to the working directory', () => {
    expect(getAllowedRoot({})).toBe(fs.realpathSync(process.cwd()))
  })
  it('rejects a root that does not exist', () => {
    expect(() => getAllowedRoot({ IDIFY_MCP_ROOT: path.join(root, 'nope') })).toThrow(
      PathGuardError
    )
  })
})

describe('resolveSafePath: reads', () => {
  it('accepts relative and absolute paths inside the root', () => {
    const file = writeFile(root, 'photos/a.png', PNG_BYTES)
    expect(read('photos/a.png')).toBe(file)
    expect(read(file)).toBe(file)
  })

  it('rejects traversal out of the root', () => {
    writeFile(outside, 'secret.png', PNG_BYTES)
    const rel = path.relative(root, path.join(outside, 'secret.png'))
    expect(() => read(rel)).toThrow(/outside the allowed root/)
    expect(() => read('../../../../etc/passwd.png')).toThrow(/outside the allowed root/)
  })

  it('rejects absolute paths outside the root', () => {
    const file = writeFile(outside, 'secret.jpg', JPEG_BYTES)
    expect(() => read(file)).toThrow(/outside the allowed root/)
  })

  it('rejects a symlinked file even when it points inside the root', () => {
    const target = writeFile(root, 'real.png', PNG_BYTES)
    fs.symlinkSync(target, path.join(root, 'link.png'))
    expect(() => read('link.png')).toThrow(/symbolic link/)
  })

  it('rejects a symlinked directory that leads outside the root', () => {
    writeFile(outside, 'secret.png', PNG_BYTES)
    fs.symlinkSync(outside, path.join(root, 'escape'))
    expect(() => read('escape/secret.png')).toThrow(/outside the allowed root/)
  })

  it('rejects disallowed extensions', () => {
    writeFile(root, 'id_ed25519', 'key')
    writeFile(root, 'notes.txt', 'x')
    expect(() => read('id_ed25519')).toThrow(/extensions/)
    expect(() => read('notes.txt')).toThrow(/extensions/)
    expect(() => read('photo.webp')).toThrow(/extensions/)
  })

  it('accepts upper-case extensions', () => {
    const file = writeFile(root, 'A.JPG', JPEG_BYTES)
    expect(read('A.JPG')).toBe(file)
  })

  it('rejects missing files and directories', () => {
    expect(() => read('missing.png')).toThrow(/does not exist/)
    fs.mkdirSync(path.join(root, 'dir.png'))
    expect(() => read('dir.png')).toThrow(/not a regular file/)
  })

  it('rejects empty paths and NUL bytes', () => {
    expect(() => read('')).toThrow(/non-empty/)
    expect(() => read('a\0.png')).toThrow(/NUL/)
  })
})

describe('resolveSafePath: writes', () => {
  it('allows new files in missing directories inside the root', () => {
    const out = write('out/nested/photo.png')
    expect(out).toBe(path.join(root, 'out/nested/photo.png'))
    ensureParentDir(out)
    expect(fs.statSync(path.dirname(out)).isDirectory()).toBe(true)
  })

  it('refuses to overwrite unless asked', () => {
    writeFile(root, 'exists.png', PNG_BYTES)
    expect(() => write('exists.png')).toThrow(/already exists.*overwrite: true/)
    expect(write('exists.png', true)).toBe(path.join(root, 'exists.png'))
  })

  it('never overwrites through a symlink, even with overwrite', () => {
    const target = writeFile(outside, 'victim.png', PNG_BYTES)
    fs.symlinkSync(target, path.join(root, 'out.png'))
    expect(() => write('out.png', true)).toThrow(/symbolic link/)
  })

  it('rejects writes through a dangling directory symlink', () => {
    fs.symlinkSync(path.join(outside, 'not-yet'), path.join(root, 'dangling'))
    expect(() => write('dangling/out.png')).toThrow(PathGuardError)
  })

  it('rejects writes outside the root (e.g. a shell rc file)', () => {
    expect(() => write(path.join(outside, 'out.png'))).toThrow(/outside the allowed root/)
    expect(() =>
      resolveSafePath('../.bashrc', {
        label: 'manifest_path',
        mode: 'write',
        extensions: MANIFEST_EXTENSIONS,
        root,
      })
    ).toThrow(/extensions/)
    expect(() =>
      resolveSafePath('../evil.json', {
        label: 'manifest_path',
        mode: 'write',
        extensions: MANIFEST_EXTENSIONS,
        root,
      })
    ).toThrow(/outside the allowed root/)
  })

  it('rejects the root itself', () => {
    expect(() => write('.')).toThrow()
  })
})

describe('assertImageFile', () => {
  it('detects PNG and JPEG by magic bytes', () => {
    expect(assertImageFile(writeFile(root, 'a.png', PNG_BYTES), 'x')).toBe('png')
    expect(assertImageFile(writeFile(root, 'b.jpg', JPEG_BYTES), 'x')).toBe('jpeg')
  })

  it('rejects files that only look like images by name', () => {
    const file = writeFile(root, 'key.png', '-----BEGIN OPENSSH PRIVATE KEY-----')
    let message = ''
    try {
      assertImageFile(file, 'input_path')
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toMatch(/not a PNG or JPEG/)
    expect(message).not.toMatch(/OPENSSH/)
  })

  it('rejects empty and oversized files', () => {
    expect(() => assertImageFile(writeFile(root, 'e.png', Buffer.alloc(0)), 'x')).toThrow(/empty/)
    const big = writeFile(root, 'big.png', Buffer.concat([PNG_BYTES, Buffer.alloc(100)]))
    expect(() => assertImageFile(big, 'x', 50)).toThrow(/too large/)
  })
})
