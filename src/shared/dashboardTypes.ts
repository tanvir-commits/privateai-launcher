export type ServiceState = 'running' | 'stopped' | 'error' | 'unknown'

export interface DashboardStatus {
  readiness: 'unsupported' | 'basic' | 'recommended' | 'creator' | 'pro' | 'unknown'
  pcReadinessLabel: string
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
  ollama: 'unknown',
  openWebui: 'unknown',
  comfyui: 'unknown',
  localChatUrl: 'http://localhost:3000',
  lanChatUrl: '',
  lastHealthAt: null,
  lastHealthSummary: null
}
