import type { DashboardStatus } from './dashboardTypes'
import type { ScriptProgressEvent } from './scriptProgress'
import type { ScriptResult } from './scriptContract'
import type { WizardInstallPersisted } from './wizardInstallPersist'

export interface HardwareScanPayload {
  system: ScriptResult | null
  gpu: ScriptResult | null
  error?: string
}

export interface PrivateaiApi {
  getWizardInstallState: () => Promise<WizardInstallPersisted>
  setWizardInstallState: (payload: WizardInstallPersisted) => Promise<WizardInstallPersisted>
  getStatus: () => Promise<DashboardStatus>
  /** Runs health check and returns updated dashboard (refreshes service dots). */
  refreshStatus: () => Promise<DashboardStatus>
  scanHardware: () => Promise<HardwareScanPayload>
  runHealth: () => Promise<ScriptResult>
  runScript: (
    name: string,
    args?: Record<string, string>,
    options?: { elevated?: boolean; timeoutMs?: number; progressToken?: string }
  ) => Promise<ScriptResult>
  /** Subscribe to coarse script progress (optional `progressToken` on `runScript`). Returns unsubscribe. */
  onScriptProgress: (listener: (payload: ScriptProgressEvent) => void) => () => void
  runRepair: (code: string) => Promise<ScriptResult>
  openExternal: (url: string) => Promise<void>
}
