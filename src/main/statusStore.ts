import { defaultDashboardStatus, type DashboardStatus, type ServiceState } from '@shared/dashboardTypes'
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

/** Applies health-check.ps1 JSON to the in-memory dashboard (service dots + LAN URL). */
export function mergeHealthIntoDashboard(r: ScriptResult): void {
  const d = r.details as Record<string, unknown> | undefined
  const phone = d?.phoneAccess as Record<string, unknown> | undefined
  const url = typeof phone?.url === 'string' ? phone.url : ''
  const dock = d?.docker as Record<string, unknown> | undefined
  const ollama = d?.ollama as Record<string, unknown> | undefined
  const ow = d?.openWebui as Record<string, unknown> | undefined
  const comfy = d?.comfyui as Record<string, unknown> | undefined

  const dockerVer =
    typeof dock?.version === 'string' && dock.version.trim().length > 0 ? String(dock.version).trim() : null

  const openWebuiState = ((): ServiceState => {
    const httpOk = ow?.httpProbeOk === true
    if (httpOk) return 'running'
    const cs = typeof ow?.containerState === 'string' ? ow.containerState : ''
    if (cs === 'running') return 'starting'
    if (cs === 'stopped') return 'stopped'
    if (cs === 'missing' || cs === 'no_docker') return 'stopped'
    return 'unknown'
  })()

  setDashboardStatus({
    lastHealthAt: new Date().toISOString(),
    lastHealthSummary: r.message,
    lanChatUrl: url || '',
    docker: typeof dock?.running === 'boolean' ? (dock.running ? 'running' : 'stopped') : 'unknown',
    dockerVersion: dockerVer,
    ollama: typeof ollama?.running === 'boolean' ? (ollama.running ? 'running' : 'stopped') : 'unknown',
    openWebui: openWebuiState,
    comfyui: typeof comfy?.running === 'boolean' ? (comfy.running ? 'running' : 'stopped') : 'unknown'
  })
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
      docker: 'unknown',
      dockerVersion: null,
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
        : 'See Check my PC'

  setDashboardStatus({
    readiness,
    pcReadinessLabel: label,
    docker: 'unknown',
    dockerVersion: null,
    ollama: 'unknown',
    openWebui: 'unknown',
    comfyui: 'unknown'
  })
}
