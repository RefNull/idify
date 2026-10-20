# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/RefNull/idify/security/advisories/new)
("Security" tab, "Report a vulnerability") rather than in a public issue.

Include the affected package (`web`, `common` or `mcp`), the commit or
version, steps to reproduce, and the impact you expect. We aim to acknowledge
reports within a week. Issues that only affect the upstream project
([zhbhun/idify](https://github.com/zhbhun/idify)) should also be reported there.

Only the latest `main` branch is supported.

## Threat model

### Web app (`packages/web`, `packages/common`)

Idify is meant to handle sensitive photos (ID and passport pictures), so the
main asset is the user's image and the main threat is that image, or data
about the user, leaving the device.

- **Everything runs locally.** Cropping, background removal (onnxruntime-web
  with locally bundled `.wasm`/`.onnx` files), retouching and print-sheet
  generation all happen in the browser. Photos are never uploaded.
- **No telemetry and no third-party requests.** There is no analytics, no
  remote font, no remote demo image, no CDN fallback and no IP geolocation.
  The default region comes from the browser's language settings.
- **Content Security Policy enforced.** The production build injects a CSP
  `<meta>` tag: `default-src 'self'`, `script-src 'self' 'wasm-unsafe-eval'`,
  `connect-src 'self' blob: data:`, `worker-src 'self' blob:`,
  `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`. The browser
  therefore blocks any connection to another origin, even if a dependency
  tried to make one. `'unsafe-inline'` is allowed for styles only (MUI/emotion
  inject `<style>` tags); `'unsafe-eval'` is not allowed.
- **Dev server.** `pnpm dev` binds to `localhost` by default and restricts
  `server.fs.allow` to the workspace packages and `node_modules`. The custom
  route that serves the model files decodes and resolves the path, refuses
  anything outside the library's `dist` folder, and only serves `.wasm`,
  `.onnx`, `.js` and `.mjs`. The dev server is not meant to be exposed to
  untrusted networks, and the CSP is not applied in dev mode.
- **Out of scope:** a compromised browser, extensions with page access, or a
  malicious host serving a modified build. Photos you save are ordinary files
  on your device.

### MCP server (`packages/mcp`)

The MCP server is driven by an AI agent, whose instructions may be influenced
by untrusted content (prompt injection). It is designed so that a misled agent
cannot use it to read or overwrite arbitrary files or to send data anywhere.

- **Filesystem confinement.** Every input and output path must resolve inside
  a single root directory: `IDIFY_MCP_ROOT` if set, otherwise the server's
  current working directory. Paths that escape the root (including through
  `..` or symlinks) are rejected.
- **Extension allowlists.** Inputs must be supported image files
  (`.png`, `.jpg`, `.jpeg`) and outputs are limited to image extensions (plus
  `.json` for tools that write a manifest), so the server cannot be used to
  write scripts or other executable content.
- **No overwrite unless asked.** Existing files are not replaced unless the
  caller explicitly requests it.
- **No network.** The server talks JSON-RPC over stdio only and makes no
  outbound connections.
- **Honest results.** Face detection, background removal and compliance
  checks run on-device with onnxruntime-node (the same models as the web
  app), or with Apple Vision when the optional native binary is built.
  Measurements an engine cannot make are reported as null with a note,
  never made up.
