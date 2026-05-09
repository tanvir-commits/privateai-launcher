/** @vitest-environment node */
import { describe, it, expect } from 'vitest'
import { parseScriptStdoutToResult } from './parseScriptOutput'

describe('parseScriptStdoutToResult', () => {
  it('parses single-line JSON', () => {
    const json =
      '{"ok":true,"status":"success","message":"ok","details":{},"warnings":[],"errors":[]}'
    const r = parseScriptStdoutToResult(json)
    expect(r?.ok).toBe(true)
    expect(r?.message).toBe('ok')
  })

  it('ignores leading noise then parses JSON line', () => {
    const stdout = `Some profile message
{"ok":false,"status":"error","message":"nope","details":{},"warnings":[],"errors":[{"code":"X","message":"nope"}]}`
    const r = parseScriptStdoutToResult(stdout)
    expect(r?.ok).toBe(false)
    expect(r?.errors[0]?.code).toBe('X')
  })

  it('returns null for invalid JSON', () => {
    expect(parseScriptStdoutToResult('not json')).toBeNull()
  })

  it('returns null when JSON is not ScriptResult shape', () => {
    expect(parseScriptStdoutToResult('{"a":1}')).toBeNull()
  })
})
