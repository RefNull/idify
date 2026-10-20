import fs from 'node:fs'
import path from 'node:path'

/**
 * Filesystem confinement for every path argument the MCP tools accept.
 *
 * All paths are resolved against a single allowed root (IDIFY_MCP_ROOT, or the
 * server's working directory). Reads must be existing regular files; writes go
 * to new files unless the caller explicitly opts into overwriting. Symlinks are
 * never followed, either for the target itself or for any existing ancestor
 * that would take the path outside the root.
 */

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg'] as const
export const PNG_EXTENSIONS = ['.png'] as const
export const MANIFEST_EXTENSIONS = ['.json'] as const

/** Largest input image we will hand to the vision engine. */
export const MAX_INPUT_IMAGE_BYTES = 50 * 1024 * 1024

export class PathGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PathGuardError'
  }
}

/**
 * The allowed root, resolved to its real path. Read from the environment on
 * every call so tests (and long-lived hosts) see changes.
 */
export function getAllowedRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.IDIFY_MCP_ROOT?.trim()
  const candidate = path.resolve(configured || process.cwd())
  let real: string
  try {
    real = fs.realpathSync(candidate)
  } catch {
    throw new PathGuardError(
      `Allowed root ${candidate} does not exist (set IDIFY_MCP_ROOT to an existing directory)`
    )
  }
  if (!fs.statSync(real).isDirectory()) {
    throw new PathGuardError(`Allowed root ${real} is not a directory`)
  }
  return real
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return (
    rel === '' ||
    (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
  )
}

function lstatOrNull(p: string): fs.Stats | null {
  try {
    return fs.lstatSync(p)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export interface SafePathOptions {
  /** Name of the tool argument, used in error messages. */
  label: string
  mode: 'read' | 'write'
  extensions: readonly string[]
  /** Write mode only: allow replacing an existing regular file. */
  overwrite?: boolean
  /** Override the root (tests); defaults to getAllowedRoot(). */
  root?: string
}

/**
 * Resolve a caller-supplied path to an absolute path that is guaranteed to sit
 * inside the allowed root, with every existing ancestor resolved through
 * realpath. Throws PathGuardError otherwise.
 */
export function resolveSafePath(input: unknown, options: SafePathOptions): string {
  const { label, mode, extensions } = options
  const root = options.root ?? getAllowedRoot()

  if (typeof input !== 'string' || input.trim() === '') {
    throw new PathGuardError(`${label} must be a non-empty path`)
  }
  if (input.includes('\0')) {
    throw new PathGuardError(`${label} contains a NUL byte`)
  }

  const resolved = path.resolve(root, input)
  const ext = path.extname(resolved).toLowerCase()
  if (!extensions.includes(ext)) {
    throw new PathGuardError(
      `${label} must have one of these extensions: ${extensions.join(', ')} (got "${ext || 'none'}")`
    )
  }
  if (!isInside(root, resolved) || resolved === root) {
    throw new PathGuardError(
      `${label} resolves outside the allowed root ${root} (set IDIFY_MCP_ROOT to widen it)`
    )
  }

  // Walk up to the nearest existing ancestor and resolve it for real, so a
  // symlinked directory cannot carry the path outside the root.
  const missing: string[] = []
  let ancestor = path.dirname(resolved)
  // lstat, not exists: a dangling symlink must count as existing so that the
  // realpath below rejects it instead of mkdir/write following it later.
  while (!lstatOrNull(ancestor)) {
    missing.unshift(path.basename(ancestor))
    const parent = path.dirname(ancestor)
    if (parent === ancestor) break
    ancestor = parent
  }
  let realAncestor: string
  try {
    realAncestor = fs.realpathSync(ancestor)
  } catch {
    throw new PathGuardError(`${label}: cannot resolve parent directory`)
  }
  if (!isInside(root, realAncestor)) {
    throw new PathGuardError(
      `${label} resolves outside the allowed root ${root} through a symbolic link`
    )
  }
  if (!fs.statSync(realAncestor).isDirectory()) {
    throw new PathGuardError(`${label}: parent path is not a directory`)
  }
  const safePath = path.join(realAncestor, ...missing, path.basename(resolved))

  const stat = lstatOrNull(safePath)
  if (stat?.isSymbolicLink()) {
    throw new PathGuardError(`${label} is a symbolic link, which is not allowed`)
  }

  if (mode === 'read') {
    if (!stat) {
      throw new PathGuardError(`${label} does not exist: ${input}`)
    }
    if (!stat.isFile()) {
      throw new PathGuardError(`${label} is not a regular file: ${input}`)
    }
    return safePath
  }

  if (stat) {
    if (!stat.isFile()) {
      throw new PathGuardError(`${label} exists and is not a regular file: ${input}`)
    }
    if (!options.overwrite) {
      throw new PathGuardError(
        `${label} already exists: ${input} (pass overwrite: true to replace it)`
      )
    }
  }
  return safePath
}

/**
 * Create the parent directory of a path already returned by resolveSafePath in
 * write mode. The nearest existing ancestor was verified to be inside the root,
 * so everything created here is inside the root too.
 */
export function ensureParentDir(safePath: string): void {
  fs.mkdirSync(path.dirname(safePath), { recursive: true })
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff]

export type ImageFormat = 'png' | 'jpeg'

/**
 * Check that a file (already passed through resolveSafePath) is a PNG or JPEG
 * by its magic bytes, and is not empty or oversized. Never reports contents.
 */
export function assertImageFile(
  safePath: string,
  label: string,
  maxBytes = MAX_INPUT_IMAGE_BYTES
): ImageFormat {
  const { size } = fs.statSync(safePath)
  if (size === 0) {
    throw new PathGuardError(`${label} is empty`)
  }
  if (size > maxBytes) {
    throw new PathGuardError(
      `${label} is too large (${size} bytes; limit ${maxBytes} bytes)`
    )
  }
  const header = Buffer.alloc(8)
  const fd = fs.openSync(safePath, 'r')
  try {
    fs.readSync(fd, header, 0, header.length, 0)
  } finally {
    fs.closeSync(fd)
  }
  if (PNG_SIGNATURE.every((byte, i) => header[i] === byte)) return 'png'
  if (JPEG_SIGNATURE.every((byte, i) => header[i] === byte)) return 'jpeg'
  throw new PathGuardError(`${label} is not a PNG or JPEG image`)
}
