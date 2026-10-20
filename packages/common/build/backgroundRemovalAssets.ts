import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

const require = createRequire(import.meta.url)

/** URL prefix the app loads the model/runtime from (see ConfigContext `publicPath`). */
export const BACKGROUND_REMOVAL_PREFIX = '/assets/background-removal'

const CONTENT_TYPES: Record<string, string> = {
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
}

/** Files copied into the production bundle (the JS is bundled by Vite itself). */
const EMIT_EXTENSIONS = new Set(['.wasm', '.onnx'])

export interface BackgroundRemovalAssetsOptions {
  /** Extra directories to resolve `@zhbhun/background-removal` from. */
  searchPaths?: string[]
  /** Directory to use when the package cannot be resolved. */
  fallbackDir?: string
}

/** Locate the `dist` folder of `@zhbhun/background-removal`. */
export function getBackgroundRemovalDist(
  options: BackgroundRemovalAssetsOptions = {}
): string | null {
  try {
    const pkgPath = require.resolve(
      '@zhbhun/background-removal/package.json',
      {
        paths: [...(options.searchPaths ?? []), __dirname, process.cwd()],
      }
    )
    const distPath = path.resolve(path.dirname(pkgPath), 'dist')
    if (fs.existsSync(distPath)) return fs.realpathSync(distPath)
  } catch {
    // fall through to the fallback
  }
  if (options.fallbackDir && fs.existsSync(options.fallbackDir)) {
    return fs.realpathSync(options.fallbackDir)
  }
  return null
}

/**
 * Map a request path (relative to the prefix) to a file inside `assetsDir`.
 * Returns null for malformed, escaping, non-allowlisted or missing paths.
 */
export function resolveAssetPath(
  assetsDir: string,
  requestUrl: string
): string | null {
  const rawPath = requestUrl.split(/[?#]/)[0]
  let decoded: string
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const resolved = path.resolve(assetsDir, '.' + path.sep + decoded)
  if (!resolved.startsWith(assetsDir + path.sep)) return null
  const ext = path.extname(resolved).toLowerCase()
  if (!(ext in CONTENT_TYPES)) return null
  let real: string
  try {
    real = fs.realpathSync(resolved)
    if (!fs.statSync(real).isFile()) return null
  } catch {
    return null
  }
  // Guard against symlinks pointing outside the asset directory.
  if (!real.startsWith(assetsDir + path.sep)) return null
  return real
}

/**
 * Serves the background-removal runtime (wasm/onnx) in dev and copies it into
 * `assets/background-removal/` on build. Used by the web app.
 */
export function backgroundRemovalAssets(
  options: BackgroundRemovalAssetsOptions = {}
): Plugin {
  const assetsDir = getBackgroundRemovalDist(options)
  return {
    name: 'idify:background-removal-assets',
    configureServer(server) {
      if (!assetsDir) return
      server.middlewares.use(BACKGROUND_REMOVAL_PREFIX, (req, res) => {
        const filePath =
          req.method === 'GET' || req.method === 'HEAD'
            ? resolveAssetPath(assetsDir, req.url || '')
            : null
        if (!filePath) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'text/plain; charset=utf-8')
          res.end('Not found')
          return
        }
        const ext = path.extname(filePath).toLowerCase()
        res.statusCode = 200
        res.setHeader('Content-Type', CONTENT_TYPES[ext])
        res.setHeader('Content-Length', fs.statSync(filePath).size)
        res.setHeader('X-Content-Type-Options', 'nosniff')
        if (req.method === 'HEAD') {
          res.end()
          return
        }
        fs.createReadStream(filePath).pipe(res)
      })
    },
    generateBundle() {
      if (!assetsDir) {
        this.warn('@zhbhun/background-removal assets not found; skipping')
        return
      }
      for (const file of fs.readdirSync(assetsDir)) {
        const filePath = path.join(assetsDir, file)
        if (
          EMIT_EXTENSIONS.has(path.extname(file).toLowerCase()) &&
          fs.statSync(filePath).isFile()
        ) {
          this.emitFile({
            type: 'asset',
            fileName: `assets/background-removal/${file}`,
            source: fs.readFileSync(filePath),
          })
        }
      }
    },
  }
}

export default backgroundRemovalAssets
