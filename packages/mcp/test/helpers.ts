import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** A fresh directory (realpath'd) to act as the allowed root. */
export function makeRoot(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'idify-mcp-test-')))
}

export const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
])
export const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46])

export function writeFile(root: string, rel: string, data: Buffer | string): string {
  const full = path.join(root, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, data)
  return full
}
