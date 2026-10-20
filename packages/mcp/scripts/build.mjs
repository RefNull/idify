#!/usr/bin/env node
// Clean build of the MCP server: type-check src, bundle it (with the shared
// @idify/common code it uses) into dist/index.js, and copy the spec database
// and face model next to it so dist/ runs standalone.
//
//   node scripts/build.mjs [outDir]   (default: dist)
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.resolve(pkgDir, process.argv[2] || 'dist')
const specSource = path.resolve(pkgDir, '../common/src/config/spec.json')
const modelSource = path.resolve(
  pkgDir,
  '../common/src/assets/models/face_detection_yunet_2023mar.onnx'
)
const modelLicense = path.resolve(pkgDir, '../common/src/assets/models/LICENSE-yunet')

for (const file of [specSource, modelSource, modelLicense]) {
  if (!fs.existsSync(file)) {
    console.error(`${file} not found`)
    process.exit(1)
  }
}

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc')
const check = spawnSync(process.execPath, [tsc, '-p', pkgDir], { stdio: 'inherit' })
if (check.status !== 0) {
  process.exit(check.status ?? 1)
}

// Validate before bundling so a broken spec file fails the build.
const specs = JSON.parse(fs.readFileSync(specSource, 'utf8'))
if (!Array.isArray(specs) || specs.length === 0) {
  console.error('spec.json must be a non-empty array')
  process.exit(1)
}

fs.rmSync(outDir, { recursive: true, force: true })
const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'))
await build({
  entryPoints: [path.join(pkgDir, 'src/index.ts')],
  outfile: path.join(outDir, 'index.js'),
  absWorkingDir: pkgDir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Runtime dependencies stay in node_modules; browser-only code paths of
  // the shared modules are never reached.
  external: [...Object.keys(pkg.dependencies), 'onnxruntime-web', '*?url'],
  legalComments: 'none',
  logLevel: 'warning',
})

fs.mkdirSync(path.join(outDir, 'data'), { recursive: true })
fs.copyFileSync(specSource, path.join(outDir, 'data', 'spec.json'))
fs.mkdirSync(path.join(outDir, 'models'), { recursive: true })
fs.copyFileSync(modelSource, path.join(outDir, 'models', path.basename(modelSource)))
fs.copyFileSync(modelLicense, path.join(outDir, 'models', 'LICENSE-yunet'))
fs.chmodSync(path.join(outDir, 'index.js'), 0o755)

console.error(`Built ${outDir} (${specs.length} specs bundled)`)
