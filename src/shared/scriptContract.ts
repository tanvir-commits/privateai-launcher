/**
 * Standard JSON contract for PowerShell scripts (stdout).
 * @see PRIVATEAI_LAUNCHER_CURSOR_SPEC.md
 */

export type ScriptStatus = 'success' | 'warning' | 'error' | 'pending' | 'running'

export interface ScriptErrorItem {
  code: string
  message: string
}

export interface ScriptResult<TDetails extends Record<string, unknown> = Record<string, unknown>> {
  ok: boolean
  status: ScriptStatus
  message: string
  details: TDetails
  warnings: string[]
  errors: ScriptErrorItem[]
}

export function emptyDetails(): Record<string, unknown> {
  return {}
}

export function scriptFailure(
  message: string,
  code: string,
  details: Record<string, unknown> = {}
): ScriptResult {
  return {
    ok: false,
    status: 'error',
    message,
    details,
    warnings: [],
    errors: [{ code, message }]
  }
}

export function scriptSuccess(
  message: string,
  details: Record<string, unknown> = {},
  warnings: string[] = []
): ScriptResult {
  return {
    ok: true,
    status: warnings.length ? 'warning' : 'success',
    message,
    details,
    warnings,
    errors: []
  }
}

export function isScriptResult(value: unknown): value is ScriptResult {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.ok === 'boolean' &&
    typeof v.status === 'string' &&
    typeof v.message === 'string' &&
    typeof v.details === 'object' &&
    v.details !== null &&
    Array.isArray(v.warnings) &&
    Array.isArray(v.errors)
  )
}
