import { describe, expect, it } from 'vitest'
import type { HardwareScanPayload } from '@shared/preloadApi'
import type { ScriptResult } from '@shared/scriptContract'
import { buildHardwareVerdictView } from './hardwareVerdict'
import { parseGpuDetails, parseSystemDetails } from './hardwareTypes'

function systemBase(over: Partial<ScriptResult> = {}): ScriptResult {
  return {
    ok: true,
    status: 'success',
    message: 'ok',
    details: {
      osCaption: 'Windows',
      osBuild: 26200,
      ramBytes: 16 * 1024 ** 3,
      diskCFreeBytes: 200 * 1024 ** 3,
      ports: {
        ollama: { port: 11434, free: true },
        openWebui: { port: 3000, free: true },
        comfyui: { port: 8188, free: true }
      }
    },
    warnings: [],
    errors: [],
    ...over
  } as ScriptResult
}

function gpuBase(over: Partial<ScriptResult> = {}): ScriptResult {
  return {
    ok: true,
    status: 'success',
    message: 'ok',
    details: {
      nvidiaPresent: true,
      gpuName: 'RTX 4060',
      vramMb: 8192,
      vramGb: 8,
      driverVersion: '550',
      detection: 'nvidia-smi',
      readiness: 'recommended',
      readinessLabel: 'Recommended'
    },
    warnings: [],
    errors: [],
    ...over
  } as ScriptResult
}

describe('buildHardwareVerdictView', () => {
  it('returns hold when system scan failed', () => {
    const last: HardwareScanPayload = {
      system: { ok: false, status: 'error', message: 'fail', details: {}, warnings: [], errors: [] },
      gpu: gpuBase()
    }
    const v = buildHardwareVerdictView(last, parseSystemDetails(last.system), parseGpuDetails(last.gpu), false)
    expect(v.kind).toBe('hold')
    expect(v.headline).toMatch(/system check/i)
  })

  it('returns go for recommended GPU, healthy system, free ports', () => {
    const last: HardwareScanPayload = { system: systemBase(), gpu: gpuBase() }
    const v = buildHardwareVerdictView(
      last,
      parseSystemDetails(last.system),
      parseGpuDetails(last.gpu),
      last.gpu!.ok === true
    )
    expect(v.kind).toBe('go')
    expect(v.lines[0]?.status).toBe('ok')
  })

  it('returns caution when no NVIDIA', () => {
    const gpu: ScriptResult = {
      ok: false,
      status: 'error',
      message: 'No NVIDIA',
      details: {
        nvidiaPresent: false,
        readiness: 'unsupported',
        readinessLabel: 'Unsupported'
      },
      warnings: [],
      errors: [{ code: 'NVIDIA_NOT_FOUND', message: 'x' }]
    }
    const last: HardwareScanPayload = { system: systemBase(), gpu }
    const v = buildHardwareVerdictView(
      last,
      parseSystemDetails(last.system),
      parseGpuDetails(last.gpu),
      false
    )
    expect(v.kind).toBe('caution')
    expect(v.lines.find((l) => l.name.startsWith('ComfyUI'))?.status).toBe('bad')
  })

  it('returns heads-up caution when only a default port is busy on a strong GPU', () => {
    const sys = systemBase({
      details: {
        osCaption: 'Windows',
        osBuild: 26200,
        ramBytes: 32 * 1024 ** 3,
        diskCFreeBytes: 200 * 1024 ** 3,
        ports: {
          ollama: { port: 11434, free: true },
          openWebui: { port: 3000, free: false },
          comfyui: { port: 8188, free: true }
        }
      }
    })
    const last: HardwareScanPayload = { system: sys, gpu: gpuBase() }
    const v = buildHardwareVerdictView(
      last,
      parseSystemDetails(last.system),
      parseGpuDetails(last.gpu),
      true
    )
    expect(v.kind).toBe('caution')
    expect(v.badge).toBe('Heads-up')
    expect(v.headline).toMatch(/port/i)
  })

  it('returns caution when RAM under 8GB even with good GPU', () => {
    const sys = systemBase({
      details: {
        osCaption: 'Windows',
        osBuild: 26200,
        ramBytes: 6 * 1024 ** 3,
        diskCFreeBytes: 200 * 1024 ** 3,
        ports: {
          ollama: { port: 11434, free: true },
          openWebui: { port: 3000, free: true },
          comfyui: { port: 8188, free: true }
        }
      },
      warnings: ['Less than 8 GB RAM detected.']
    })
    const last: HardwareScanPayload = { system: sys, gpu: gpuBase() }
    const v = buildHardwareVerdictView(
      last,
      parseSystemDetails(last.system),
      parseGpuDetails(last.gpu),
      true
    )
    expect(v.kind).toBe('caution')
  })
})
