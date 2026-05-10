import { describe, expect, it } from 'vitest'
import type { HardwareScanPayload } from '@shared/preloadApi'
import type { ScriptResult } from '@shared/scriptContract'
import {
  buildModelProfileFit,
  hardwareSummaryLine,
  inferredMinLogicalForOllamaTag,
  sortProfilesByHardwareFit,
  type ModelProfileRow
} from './modelHardwareFit'

type CpuOpts = { threads?: number; physical?: number; name?: string }

function systemOk(ramGb: number, cpu?: CpuOpts, over: Partial<ScriptResult> = {}): ScriptResult {
  const threads = cpu?.threads ?? 16
  const physical = cpu?.physical ?? 8
  const name = cpu?.name ?? 'Test CPU'
  const { details: _d, ...restOver } = over
  return {
    ok: true,
    status: 'success',
    message: 'ok',
    details: {
      osCaption: 'Windows',
      osBuild: 26200,
      ramBytes: ramGb * 1024 ** 3,
      diskCFreeBytes: 200 * 1024 ** 3,
      ports: {},
      cpuLogicalProcessors: threads,
      cpuPhysicalCores: physical,
      cpuName: name,
      ...(typeof over.details === 'object' && over.details !== null ? (over.details as Record<string, unknown>) : {})
    },
    warnings: [],
    errors: [],
    ...restOver
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
  cpuFallbackPull: 'llama3.2:3b',
  minLogicalProcessorsGpu: 6
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

describe('inferredMinLogicalForOllamaTag', () => {
  it('maps small tags to 4', () => {
    expect(inferredMinLogicalForOllamaTag('llama3.2:3b')).toBe(4)
  })
  it('maps 7b-class tags to 8', () => {
    expect(inferredMinLogicalForOllamaTag('qwen2.5:7b')).toBe(8)
  })
})

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

  it('tightens CPU-only fit when very few threads', () => {
    const scan: HardwareScanPayload = {
      system: systemOk(16, { threads: 2 }),
      gpu: gpuMissing()
    }
    const f = buildModelProfileFit(text7b, scan)
    expect(f.label).toBe('tight')
    expect(f.effectivePull).toBe('llama3.2:3b')
    expect(f.hint).toMatch(/2 CPU thread/)
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

  it('marks ideal when VRAM has headroom and CPU is strong enough', () => {
    const scan: HardwareScanPayload = {
      system: systemOk(16),
      gpu: gpuOk(12 * 1024)
    }
    const f = buildModelProfileFit(text7b, scan)
    expect(f.label).toBe('ideal')
    expect(f.effectivePull).toBe('qwen2.5:7b')
  })

  it('softens GPU fit when CPU thread count is low', () => {
    const scan: HardwareScanPayload = {
      system: systemOk(16, { threads: 4 }),
      gpu: gpuOk(12 * 1024)
    }
    const f = buildModelProfileFit(text7b, scan)
    expect(f.label).toBe('ok')
    expect(f.hint).toMatch(/Few CPU threads/)
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

  it('includes RAM, CPU layout, and VRAM when present', () => {
    const scan: HardwareScanPayload = {
      system: systemOk(16),
      gpu: gpuOk(8192)
    }
    const line = hardwareSummaryLine(scan)
    expect(line).toMatch(/16\.0 GB RAM/)
    expect(line).toMatch(/8c\/16t/)
    expect(line).toMatch(/8\.0 GB VRAM/)
  })
})
