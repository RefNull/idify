import type { Plugin } from 'vite'

/**
 * Content Security Policy for the production build.
 *
 * - script-src 'wasm-unsafe-eval': onnxruntime-web compiles WebAssembly.
 * - worker-src blob: the inference proxy worker is created from a Blob URL.
 * - connect-src blob: data: the runtime fetches the .wasm files through Blob
 *   URLs it creates itself; uploaded photos are Blob URLs too.
 * - style-src 'unsafe-inline': MUI/emotion inject <style> tags at runtime.
 * No third-party origin is allowed anywhere, so the app cannot phone home.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

/**
 * Injects the CSP <meta> tag at build time only. In dev, Vite and
 * @vitejs/plugin-react inject inline scripts (HMR client, react-refresh
 * preamble) that this policy would block.
 */
export function contentSecurityPolicy(
  policy: string = CONTENT_SECURITY_POLICY
): Plugin {
  return {
    name: 'idify:content-security-policy',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

export default contentSecurityPolicy
