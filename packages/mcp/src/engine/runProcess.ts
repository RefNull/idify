import { spawn } from 'node:child_process'

export interface RunOptions {
  timeoutMs?: number
  maxStdoutBytes?: number
  maxStderrBytes?: number
}

export const DEFAULT_TIMEOUT_MS = 60_000
export const DEFAULT_MAX_STDOUT_BYTES = 1024 * 1024
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024

function errorDetail(stdout: string, stderr: string): string {
  // The native binary reports failures as JSON on stdout ({ message } or
  // { error }); prefer that, else a short tail of stderr.
  try {
    const parsed = JSON.parse(stdout.trim())
    const msg = parsed?.message ?? parsed?.error
    if (typeof msg === 'string' && msg) return msg
  } catch {
    // not JSON
  }
  const tail = stderr.trim().slice(-500)
  return tail || 'no diagnostic output'
}

/**
 * Run a binary with an argv array (never a shell), enforcing a wall-clock
 * timeout and an stdout size cap, and parse its stdout as a single JSON value.
 * A non-zero exit, a signal, a timeout, oversized or non-JSON output all reject.
 */
export function runJsonProcess(
  command: string,
  args: string[],
  options: RunOptions = {}
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxStdout = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES
  const maxStderr = options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES
  const name = command.split(/[\\/]/).pop() || command

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const stdoutChunks: Buffer[] = []
    let stdoutBytes = 0
    let stderr = ''
    let failure: Error | null = null
    let settled = false

    const fail = (err: Error) => {
      if (!failure) failure = err
      child.kill('SIGKILL')
    }

    const timer = setTimeout(() => {
      fail(new Error(`${name} timed out after ${Math.round(timeoutMs / 1000)} s`))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > maxStdout) {
        fail(new Error(`${name} produced more than ${maxStdout} bytes of output`))
        return
      }
      stdoutChunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < maxStderr) {
        stderr += chunk.toString('utf8').slice(0, maxStderr - stderr.length)
      }
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      reject(new Error(`Failed to start ${name}: ${err.message}`))
    })

    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      if (failure) {
        reject(failure)
        return
      }
      const stdout = Buffer.concat(stdoutChunks).toString('utf8')
      if (code !== 0) {
        const how = signal ? `was killed by ${signal}` : `exited with code ${code}`
        reject(new Error(`${name} ${how}: ${errorDetail(stdout, stderr)}`))
        return
      }
      const trimmed = stdout.trim()
      if (!trimmed) {
        reject(new Error(`${name} produced no output`))
        return
      }
      try {
        resolve(JSON.parse(trimmed))
      } catch {
        reject(new Error(`${name} produced output that is not valid JSON`))
      }
    })
  })
}
