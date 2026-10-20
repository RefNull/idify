#!/usr/bin/env node
// Fail (exit 1) when the committed dist/ does not match a fresh build of src/.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const committed = path.join(pkgDir, 'dist')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'idify-mcp-dist-'))
const fresh = path.join(tmp, 'dist')

function listFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? listFiles(full, base) : [path.relative(base, full)]
  })
}

try {
  const build = spawnSync(process.execPath, [path.join(pkgDir, 'scripts/build.mjs'), fresh], {
    stdio: 'inherit',
  })
  if (build.status !== 0) {
    console.error('check:dist: fresh build failed')
    process.exit(1)
  }

  const a = new Set(listFiles(committed))
  const b = new Set(listFiles(fresh))
  const problems = []
  for (const f of b) if (!a.has(f)) problems.push(`missing from dist: ${f}`)
  for (const f of a) if (!b.has(f)) problems.push(`stale file in dist: ${f}`)
  for (const f of b) {
    if (a.has(f) && !fs.readFileSync(path.join(committed, f)).equals(fs.readFileSync(path.join(fresh, f)))) {
      problems.push(`differs from src build: ${f}`)
    }
  }

  if (problems.length) {
    console.error('check:dist: packages/mcp/dist is out of date with src:')
    for (const p of problems) console.error(`  ${p}`)
    console.error('Run "pnpm --filter @idify/mcp build" and commit dist/.')
    process.exit(1)
  }
  console.error(`check:dist: dist matches src (${b.size} files)`)
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
