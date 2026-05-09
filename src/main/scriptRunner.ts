import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { parseScriptStdoutToResult } from '@shared/parseScriptOutput'
import { scriptFailure, type ScriptResult } from '@shared/scriptContract'
import { getWindowsScriptsDir } from './paths'

export interface RunScriptOptions {
  /** Script file name only, e.g. `check-system.ps1` */
  scriptName: string
  /** Passed as `-Key value` after script path (PowerShell splatting via individual args). */
  args?: Record<string, string | number | boolean>
  timeoutMs?: number
  /**
   * If true, launches an elevated PowerShell via UAC (Start-Process -Verb RunAs).
   * Use for installer/repair steps that need admin rights.
   */
  elevated?: boolean
}

function buildPsArgs(scriptPath: string, args?: Record<string, string | number | boolean>): string[] {
  const out = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath]
  if (!args) return out
  for (const [k, v] of Object.entries(args)) {
    out.push(`-${k}`, String(v))
  }
  return out
}

/** Scripts that only use user-session tools (Docker CLI, etc.); elevation adds UAC and can hang JSON relay. */
const NEVER_ELEVATE_SCRIPT_NAMES = new Set(['check-docker.ps1', 'probe-docker-engine.ps1'])

/**
 * Runs a launcher PowerShell script and parses its JSON stdout into {@link ScriptResult}.
 */
export function runPowerShellScript(options: RunScriptOptions): Promise<ScriptResult> {
  let { scriptName, args, timeoutMs = 120_000, elevated = false } = options
  if (NEVER_ELEVATE_SCRIPT_NAMES.has(scriptName) && elevated) {
    elevated = false
  }
  const dir = getWindowsScriptsDir()
  const scriptPath = join(dir, scriptName)
  if (elevated) {
    return runPowerShellScriptElevated({ scriptName, scriptPath, args, timeoutMs })
  }

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

async function runPowerShellScriptElevated(input: {
  scriptName: string
  scriptPath: string
  args?: Record<string, string | number | boolean>
  timeoutMs: number
}): Promise<ScriptResult> {
  const { scriptName, scriptPath, args, timeoutMs } = input
  const tmpDir = join(os.tmpdir(), 'privateai-launcher', randomUUID())
  const outFile = join(tmpDir, 'stdout.txt')
  const errFile = join(tmpDir, 'stderr.txt')
  const childStdoutFile = join(tmpDir, 'elev-child-stdout.txt')
  const childStderrFile = join(tmpDir, 'elev-child-stderr.txt')
  const innerExitFile = join(tmpDir, 'inner-exit.txt')
  const outerExitFile = join(tmpDir, 'outer-exit.txt')
  const outerErrFile = join(tmpDir, 'outer-launch.txt')
  const innerWrapperPath = join(tmpDir, 'elevated-inner.ps1')
  const outerWrapperPath = join(tmpDir, 'elevated-outer.ps1')
  await fs.mkdir(tmpDir, { recursive: true })

  const psExe =
    process.env.SystemRoot != null
      ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe'

  const childArgListPs = buildPsArgs(scriptPath, args)
    .map((a) => `'${escapePsSingleQuoted(a)}'`)
    .join(',')

  const innerScript = [
    '$ErrorActionPreference = "Continue"',
    '$utf8NoBom = New-Object System.Text.UTF8Encoding $false',
    'try {',
    // Elevated pipelines (*>&1 | Out-String) can still deadlock on merged streams after the script
    // finishes work (Docker check hits 100% while IPC never completes). Spawn a nested powershell.exe
    // with stdout/stderr redirected to temp files instead.
    `  Remove-Item -LiteralPath '${escapePsSingleQuoted(childStdoutFile)}','${escapePsSingleQuoted(childStderrFile)}' -Force -ErrorAction SilentlyContinue`,
    `  $spawnArgs = @{`,
    `    FilePath                 = '${escapePsSingleQuoted(psExe)}'`,
    `    ArgumentList             = @(${childArgListPs})`,
    `    Wait                     = $true`,
    `    PassThru                 = $true`,
    `    NoNewWindow              = $true`,
    // Omit UseShellExecute: Windows PowerShell 5.1 (elevated child is powershell.exe) has no such parameter; PS 6+ added it.
    `    RedirectStandardOutput   = '${escapePsSingleQuoted(childStdoutFile)}'`,
    `    RedirectStandardError    = '${escapePsSingleQuoted(childStderrFile)}'`,
    `  }`,
    `  $p = Start-Process @spawnArgs`,
    `  $outRaw = if (Test-Path -LiteralPath '${escapePsSingleQuoted(childStdoutFile)}') { [System.IO.File]::ReadAllText('${escapePsSingleQuoted(childStdoutFile)}') } else { '' }`,
    `  $errRaw = if (Test-Path -LiteralPath '${escapePsSingleQuoted(childStderrFile)}') { [System.IO.File]::ReadAllText('${escapePsSingleQuoted(childStderrFile)}') } else { '' }`,
    // Do not merge stderr into stdout: winget/docker/DISM flood stderr and break JSON parsing (INVALID_SCRIPT_OUTPUT).
    `  [System.IO.File]::WriteAllText('${escapePsSingleQuoted(outFile)}', $outRaw, $utf8NoBom)`,
    `  [System.IO.File]::WriteAllText('${escapePsSingleQuoted(errFile)}', $errRaw, $utf8NoBom)`,
    '  $ec = 0',
    '  if ($null -ne $p.ExitCode) { $ec = [int]$p.ExitCode }',
    `  [System.IO.File]::WriteAllText('${escapePsSingleQuoted(innerExitFile)}', "$ec", $utf8NoBom)`,
    '} catch {',
    `  [System.IO.File]::WriteAllText('${escapePsSingleQuoted(errFile)}', ($_ | Out-String), $utf8NoBom)`,
    `  [System.IO.File]::WriteAllText('${escapePsSingleQuoted(innerExitFile)}', '1', $utf8NoBom)`,
    '}'
  ].join('\r\n')

  const outerScript = [
    '$ErrorActionPreference = "Stop"',
    `try {`,
    `  $p = Start-Process -FilePath '${escapePsSingleQuoted(psExe)}' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${escapePsSingleQuoted(innerWrapperPath)}' -Verb RunAs -Wait -PassThru`,
    `  Set-Content -LiteralPath '${escapePsSingleQuoted(outerExitFile)}' -Value $p.ExitCode`,
    `} catch {`,
    `  $_.Exception.Message + [Environment]::NewLine + $_.ScriptStackTrace | Set-Content -LiteralPath '${escapePsSingleQuoted(outerErrFile)}' -Encoding utf8`,
    `  Set-Content -LiteralPath '${escapePsSingleQuoted(outerExitFile)}' -Value 4294967295`,
    '}'
  ].join('\r\n')

  await fs.writeFile(innerWrapperPath, innerScript, 'utf8')
  await fs.writeFile(outerWrapperPath, outerScript, 'utf8')

  return new Promise((resolve) => {
    const child = spawn(
      psExe,
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', outerWrapperPath],
      { windowsHide: false }
    )

    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      resolve(
        scriptFailure('Elevated script timed out', 'SCRIPT_TIMEOUT', {
          scriptName,
          timeoutMs,
          elevated: true
        })
      )
    }, timeoutMs)

    const finish = async (): Promise<void> => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        const stdout = await readTextSafe(outFile)
        const stderr = await readTextSafe(errFile)
        const outerExit = (await readTextSafe(outerExitFile)).trim()
        const innerExit = (await readTextSafe(innerExitFile)).trim()
        const outerLaunchErr = await readTextSafe(outerErrFile)

        if (outerLaunchErr.trim()) {
          resolve(
            scriptFailure('Could not start elevated installer.', 'ELEVATION_LAUNCH_FAILED', {
              scriptName,
              elevated: true,
              details: outerLaunchErr.slice(0, 2000)
            })
          )
          return
        }

        const outerNum = parseInt(outerExit, 10)
        if (outerExit === '4294967295' || outerNum === 4294967295) {
          resolve(
            scriptFailure(
              'Administrator permission was not granted or elevation failed (UAC).',
              'ELEVATION_CANCELLED',
              { scriptName, elevated: true }
            )
          )
          return
        }

        const parsed = parseScriptStdoutToResult(stdout)
        if (parsed) {
          if (stderr.trim()) {
            parsed.details = { ...parsed.details, stderrTail: stderr.slice(-4000) }
          }
          if (innerExit && innerExit !== '0') {
            parsed.details = { ...parsed.details, innerExitCode: innerExit }
          }
          resolve(parsed)
          return
        }

        if (!stdout.trim() && !stderr.trim() && !outerExit) {
          resolve(
            scriptFailure(
              'Elevation produced no output. If you did not see a UAC prompt, try signing out or check Task Manager for a pending consent window.',
              'ELEVATION_NO_OUTPUT',
              { scriptName, elevated: true }
            )
          )
          return
        }

        resolve(
          scriptFailure('Elevated script did not emit valid JSON', 'INVALID_SCRIPT_OUTPUT', {
            scriptName,
            elevated: true,
            exitCode: outerExit || innerExit || null,
            stdoutTail: stdout.slice(-4000),
            stderrTail: stderr.slice(-4000)
          })
        )
      } catch (err) {
        resolve(
          scriptFailure('Failed to collect elevated script output', 'ELEVATED_OUTPUT_READ_FAILED', {
            scriptName,
            elevated: true,
            error: String(err)
          })
        )
      } finally {
        void fs.rm(tmpDir, { recursive: true, force: true })
      }
    }

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(
        scriptFailure('Failed to start elevation launcher', 'SPAWN_ERROR', {
          scriptName,
          elevated: true,
          error: String(err)
        })
      )
    })

    child.on('close', () => {
      void finish()
    })
  })
}

function escapePsSingleQuoted(v: string): string {
  return v.replaceAll("'", "''")
}

async function readTextSafe(path: string): Promise<string> {
  try {
    const s = await fs.readFile(path, 'utf8')
    return s.replace(/^\uFEFF/, '')
  } catch {
    return ''
  }
}
