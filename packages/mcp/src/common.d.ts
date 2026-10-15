// The web app's face detector imports its model through Vite. The MCP bundle
// never reaches that code path; this only satisfies the type checker.
declare module '*.onnx?url' {
  const url: string
  export default url
}
