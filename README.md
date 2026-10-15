# Idify

Idify makes ID photos in your browser. Photos never leave your device.

This is a fork of [zhbhun/idify](https://github.com/zhbhun/idify).

## Features

- Specs for passports, visas and ID cards from most countries
- Background removal and replacement
- Brightness, contrast and filter adjustments
- 4×6" print sheets
- Works offline as an installable web app

## What this fork adds

**Better photos**

- The crop frames your head automatically. It finds your face and sizes and positions it to the spec's head-height and eye-line rules.
- Guides on the cropper show where your chin and the top of your head need to be.
- Background removal leaves clean edges, without a pale halo from the old background.
- Background removal stays off for countries that don't allow edited backgrounds, such as the UK, Canada and Australia.
- Print sheets include cut guides and the correct print resolution.

**Easier to use**

- Find a spec by typing: "In" shows India, Indonesia and so on. It also works with country codes and country names in your language.
- Filter specs by type, and get your recent picks and your country's specs suggested first.
- The app warns you about filters or backgrounds that a passport office would reject.

**Private by default**

- No analytics, tracking or IP lookup, and no fonts, images or models loaded from other sites.
- The app's security policy blocks connections to any other site.

**Corrected spec data**

- Head-size and eye-height rules were checked against official sources and fixed where they were wrong.

**MCP server for AI agents** (see below)

The Android app was dropped; the web app can be installed instead.

## Privacy

Everything runs locally. Photos are never uploaded. See [SECURITY.md](SECURITY.md).

## Developing

```shell
pnpm install
pnpm dev
```

## MCP server

`packages/mcp` lets AI agents look up photo specs, check whether a photo meets a spec, crop it to a spec and make a print sheet. It uses the same face detection and background removal as the web app, runs on macOS, Linux and Windows, and works offline.

Build it with `pnpm build` and point your MCP client at `packages/mcp/dist/index.js`. Set `IDIFY_MCP_ROOT` to the folder it may read and write; it can't touch anything outside it.

On Apple Silicon Macs, `pnpm --filter @idify/mcp build:native` adds an optional Apple Vision engine that also checks head pitch and photo quality.

## License

GPL-3.0
