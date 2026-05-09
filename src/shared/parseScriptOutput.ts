import { isScriptResult, type ScriptResult } from './scriptContract'

/**
 * Extracts the first JSON object from stdout that validates as ScriptResult.
 * Scripts should emit a single-line JSON (ConvertTo-Json -Compress) as the last line,
 * or only JSON. Leading non-JSON lines (e.g. profile noise) are ignored.
 */
export function parseScriptStdoutToResult(stdout: string): ScriptResult | null {
  const text = stdout.trim()
  if (!text) return null

  const candidates = collectJsonCandidates(text)
  for (const chunk of candidates) {
    try {
      const parsed: unknown = JSON.parse(chunk)
      if (isScriptResult(parsed)) {
        return parsed as ScriptResult
      }
    } catch {
      // try next candidate
    }
  }
  return null
}

/**
 * Finds balanced `{ ... }` regions and full-line JSON attempts, newest/longest last.
 */
function collectJsonCandidates(text: string): string[] {
  const out: string[] = []
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const t = line.trim()
    if (t.startsWith('{') && t.endsWith('}')) {
      out.push(t)
    }
  }

  // Multi-line / embedded: scan for outermost objects by brace balance
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue
    const end = findBalancedJsonEnd(text, i)
    if (end > i) {
      out.push(text.slice(i, end + 1).trim())
      i = end
    }
  }

  // Prefer later JSON (often the script footer); dedupe while preserving order
  const seen = new Set<string>()
  const deduped: string[] = []
  for (const c of out.reverse()) {
    if (seen.has(c)) continue
    seen.add(c)
    deduped.push(c)
  }
  return deduped.reverse()
}

function findBalancedJsonEnd(s: string, start: number): number {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]!
    if (inString) {
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}
