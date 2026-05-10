import { describe, expect, it } from 'vitest'
import type { HardwareScanPayload } from '@shared/preloadApi'
import type { ScriptResult } from '@shared/scriptContract'
import { buildModelProfileFit, hardwareSummaryLine, sortProfilesByHardwareFit, type ModelProfileRow } from './modelHardwareFit'

function systemOk(ramGb: number, over: Partial<ScriptResult> = {}): ScriptResult {
  return {
    ok: true,
    status: 'success',
    message: 'ok',
    details: {
      osCaption: 'Windows',
      osBuild: 26200,
      ramBytes: ramGb * 1024 ** 3,
      diskCFreeBytes: 200 * 1024 ** 3,
      ports: {}
    },
    warnings: [],
    errors: [],
    ...over
  } as ScriptResult
}

function gpuOk(vramMb: number, over: Partial<ScriptResult> = {}): ScriptResult {
  const vramGb = Math.round((vramMb / 1024) * 10) / 10
  return {
    ok: true,
    status: 'success',
    message: 'ok',
    details: {
      nvidiaPresent: true,
      gpuName: 'Test GPU',
      vramMb,
      vramGb,
      driverVersion: '1',
      detection: 'nvidia-smi',
      readiness: 'recommended',
      readinessLabel: 'Recommended: good balance for chat and image workflows.'
    },
    warnings: [],
    errors: [],
    ...over
  } as ScriptResult
}

function gpuMissing(): ScriptResult {
  return {
    ok: false,
    status: 'error',
    message: 'No NVIDIA GPU detected.',
    details: {
      nvidiaPresent: false,
      gpuName: null,
      vramMb: null,
      vramGb: null,
      driverVersion: null,
      detection: null,
      readiness: 'unsupported',
      readinessLabel: 'Unsupported: no NVIDIA GPU detected.'
    },
    warnings: [],
    errors: [{ code: 'NVIDIA_NOT_FOUND', message: 'x' }]
  } as ScriptResult
}

const text7b: ModelProfileRow = {
  id: 'text-7b',
  label: 'Text 7b',
  description: 'd',
  ollamaPull: 'qwen2.5:7b',
  approxSizeGb: 4.5,
  minVramGb: 6,
  minRamGb: 8,
  cpuFallbackPull: 'llama3.2:3b'
}

const vision: ModelProfileRow = {
  id: 'vision-7b',
  label: 'Vision',
  description: 'd',
  ollamaPull: 'qwen2.5vl:7b',
  approxSizeGb: 6,
  minVramGb: 10,
  minRamGb: 8,
  requiresNvidia: true
}

describe('buildModelProfileFit', () => {
  it('asks for Check my PC when there is no scan', () => {
    const f = buildModelProfileFit(text7b, null)
    expect(f.effectivePull).toBe('qwen2.5:7b')
    expect(f.hint).toMatch(/Check my PC/)
  })

  it('uses CPU fallback when no NVIDIA GPU', () => {
    const scan: HardwareScanPayload = {
      system: systemOk(16),
      gpu: gpuMissing()
    }
    const f = buildModelProfileFit(text7b, scan)
    expect(f.label).toBe('substitute')
    expect(f.effectivePull).toBe('llama3.2:3b')
  })

  it('flags vision when no NVIDIA', () => {
    const scan: HardwareScanPayload = { system: systemOk(16), gpu: gpuMissing() }
    const f = buildModelProfileFit(vision, scan)
    expect(f.label).toBe('blocked')
    expect(f.effectivePull).toBeNull()
  })

  it('uses substitute when VRAM is below min for 7b text', () => {
    const scan: HardwareScanPayload = {
      system: systemOk(16),
      gpu: gpuOk(4096)
    }
    const f = buildModelProfileFit(text7b, scan)
    expect(f.label).toBe('substitute')
    expect(f.effectivePull).toBe('llama3.2:3b')
  })

  it('marks ideal when VRAM has headroom', () => {
    const scan: HardwareScanPayload = {
      system: systemOk(16),
      gpu: gpuOk(12 * 1024)
    }
    const f = buildModelProfileFit(text7b, scan)
    expect(f.label).toBe('ideal')
    expect(f.effectivePull).toBe('qwen2.5:7b')
  })
})

describe('sortProfilesByHardwareFit', () => {
  it('orders higher sortKey first', () => {
    const scan: HardwareScanPayload = {
      system: systemOk(16),
      gpu: gpuOk(12 * 1024)
    }
    const rows: ModelProfileRow[] = [vision, text7b]
    const sorted = sortProfilesByHardwareFit(rows, scan).map((x) => x.profile.id)
    expect(sorted[0]).toBe('text-7b')
    expect(sorted[1]).toBe('vision-7b')
  })
})

describe('hardwareSummaryLine', () => {
  it('returns null when no scan', () => {
    expect(hardwareSummaryLine(null)).toBeNull()
  })

  it('includes RAM and VRAM when present', () => {
    const scan: HardwareScanPayload = {
      system: systemOk(16),
      gpu: gpuOk(8192)
    }
    const line = hardwareSummaryLine(scan)
    expect(line).toMatch(/16\.0 GB RAM/)
    expect(line).toMatch(/8\.0 GB VRAM/)
  })
})
