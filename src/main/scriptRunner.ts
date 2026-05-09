import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { parseScriptStdoutToResult } from '@shared/parseScriptOutput'
import { scriptFailure, type ScriptResult } from '@shared/scriptContract'
import { getWindowsScriptsDir } from './paths'

export interface RunScriptOptions {
  /** Script file name only, e.g. `check-system.ps1` */
  scriptName: string
  /** Passed as `-Key value` after script path (PowerShell splatting via individual args). */
  args?: Record<string, string | number | boolean>
  timeoutMs?: number
}

function buildPsArgs(scriptPath: string, args?: Record<string, string | number | boolean>): string[] {
  const out = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
  if (!args) return out
  for (const [k, v] of Object.entries(args)) {
    out.push(`-${k}`, String(v))
  }
  return out
}

/**
 * Runs a launcher PowerShell script and parses its JSON stdout into {@link ScriptResult}.
 */
export function runPowerShellScript(options: RunScriptOptions): Promise<ScriptResult> {
  const { scriptName, args, timeoutMs = 120_000 } = options
  const dir = getWindowsScriptsDir()
  const scriptPath = join(dir, scriptName)

  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []
    const child = spawn(
      'powershell.exe',
      buildPsArgs(scriptPath, args),
      { windowsHide: true }
    )

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      resolve(
        scriptFailure('Script timed out', 'SCRIPT_TIMEOUT', {
          scriptName,
          timeoutMs
        })
      )
    }, timeoutMs)

    const finish = (result: ScriptResult): void => {
      clearTimeout(timer)
      resolve(result)
    }

    child.stdout?.on('data', (d: Buffer) => chunks.push(d))
    child.stderr?.on('data', (d: Buffer) => errChunks.push(d))

    child.on('error', (err) => {
      finish(
        scriptFailure('Failed to start PowerShell', 'SPAWN_ERROR', {
          scriptName,
          error: String(err)
        })
      )
    })

    child.on('close', (code) => {
      const stdout = Buffer.concat(chunks).toString('utf8')
      const stderr = Buffer.concat(errChunks).toString('utf8')
      const parsed = parseScriptStdoutToResult(stdout)
      if (parsed) {
        if (stderr.trim()) {
          parsed.details = { ...parsed.details, stderrTail: stderr.slice(-4000) }
        }
        finish(parsed)
        return
      }
      finish(
        scriptFailure('Script did not emit valid JSON', 'INVALID_SCRIPT_OUTPUT', {
          scriptName,
          exitCode: code,
          stdoutTail: stdout.slice(-4000),
          stderrTail: stderr.slice(-4000)
        })
      )
    })
  })
}
