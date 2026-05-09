import { defaultDashboardStatus, type DashboardStatus } from '@shared/dashboardTypes'
import type { ScriptResult } from '@shared/scriptContract'
import { runPowerShellScript } from './scriptRunner'

export interface HardwareScanPayload {
  system: ScriptResult | null
  gpu: ScriptResult | null
  error?: string
}

let dashboard: DashboardStatus = { ...defaultDashboardStatus }
let lastHardware: HardwareScanPayload | null = null

export function getDashboardStatus(): DashboardStatus {
  return dashboard
}

export function setDashboardStatus(patch: Partial<DashboardStatus>): void {
  dashboard = { ...dashboard, ...patch }
}

export function getLastHardwareScan(): HardwareScanPayload | null {
  return lastHardware
}

export async function refreshHardwareScan(): Promise<HardwareScanPayload> {
  try {
    const [system, gpu] = await Promise.all([
      runPowerShellScript({ scriptName: 'check-system.ps1', timeoutMs: 60_000 }),
      runPowerShellScript({ scriptName: 'check-gpu.ps1', timeoutMs: 60_000 })
    ])
    lastHardware = { system, gpu }
    applyHardwareToDashboard(system, gpu)
    return lastHardware
  } catch (e) {
    const err = { system: null, gpu: null, error: String(e) }
    lastHardware = err
    return err
  }
}

function applyHardwareToDashboard(system: ScriptResult, gpu: ScriptResult): void {
  const dGpu = gpu.details as Record<string, unknown> | undefined
  const gpuOk = gpu.ok && dGpu?.nvidiaPresent === true

  if (!gpuOk) {
    setDashboardStatus({
      readiness: 'unsupported',
      pcReadinessLabel: 'No supported NVIDIA GPU detected',
      ollama: 'unknown',
      openWebui: 'unknown',
      comfyui: 'unknown'
    })
    return
  }

  const readiness = (dGpu?.readiness as DashboardStatus['readiness']) ?? 'unknown'
  const label =
    typeof dGpu?.readinessLabel === 'string'
      ? String(dGpu.readinessLabel)
      : typeof system.message === 'string'
        ? system.message
        : 'See Hardware Doctor'

  setDashboardStatus({
    readiness,
    pcReadinessLabel: label,
    ollama: 'unknown',
    openWebui: 'unknown',
    comfyui: 'unknown'
  })
}
