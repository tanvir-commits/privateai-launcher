/** `starting` = backing process/container up but HTTP probe not OK yet (e.g. Open WebUI still binding or crash loop). */
export type ServiceState = 'running' | 'starting' | 'stopped' | 'error' | 'unknown'

export interface DashboardStatus {
  readiness: 'unsupported' | 'basic' | 'recommended' | 'creator' | 'pro' | 'unknown'
  pcReadinessLabel: string
  /** Linux engine answering (from health check); use Hardware Doctor for GPU readiness. */
  docker: ServiceState
  /** Docker Engine / API version when running */
  dockerVersion: string | null
  ollama: ServiceState
  openWebui: ServiceState
  comfyui: ServiceState
  localChatUrl: string
  lanChatUrl: string
  lastHealthAt: string | null
  lastHealthSummary: string | null
}

export const defaultDashboardStatus: DashboardStatus = {
  readiness: 'unknown',
  pcReadinessLabel: 'Not scanned yet',
  docker: 'unknown',
  dockerVersion: null,
  ollama: 'unknown',
  openWebui: 'unknown',
  comfyui: 'unknown',
  localChatUrl: 'http://localhost:3000',
  lanChatUrl: '',
  lastHealthAt: null,
  lastHealthSummary: null
}
