/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPowerShellScript } from './scriptRunner'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd()
  }
}))

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('runPowerShellScript', () => {
  it.skipIf(process.platform !== 'win32')('parses JSON from check-system.ps1', async () => {
    const r = await runPowerShellScript({ scriptName: 'check-system.ps1', timeoutMs: 120_000 })
    expect(typeof r.ok).toBe('boolean')
    expect(r.status).toBeTruthy()
    expect(Array.isArray(r.errors)).toBe(true)
  }, 180_000)
})
