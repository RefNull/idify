#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { createServer } from './server.js'

// stdout carries the MCP protocol only. Route any stray console output to
// stderr so a log line can never corrupt the stream.
console.log = console.error
console.info = console.error
console.debug = console.error

async function main() {
  const server = createServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('idify-mcp failed to start:', err instanceof Error ? err.message : err)
  process.exit(1)
})
