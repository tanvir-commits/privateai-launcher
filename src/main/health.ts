import type { ScriptResult } from '@shared/scriptContract'
import { runPowerShellScript } from './scriptRunner'

export async function runHealthCheck(): Promise<ScriptResult> {
  return runPowerShellScript({ scriptName: 'health-check.ps1', timeoutMs: 120_000 })
}
