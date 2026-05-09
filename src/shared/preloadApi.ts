import type { DashboardStatus } from './dashboardTypes'
import type { ScriptResult } from './scriptContract'

export interface HardwareScanPayload {
  system: ScriptResult | null
  gpu: ScriptResult | null
  error?: string
}

export interface PrivateaiApi {
  getStatus: () => Promise<DashboardStatus>
  scanHardware: () => Promise<HardwareScanPayload>
  runHealth: () => Promise<ScriptResult>
  runScript: (name: string, args?: Record<string, string>) => Promise<ScriptResult>
  runRepair: (code: string) => Promise<ScriptResult>
  openExternal: (url: string) => Promise<void>
}
