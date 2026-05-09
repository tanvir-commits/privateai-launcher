import type { ServiceState } from '@shared/dashboardTypes'
import type { StatusTone } from '../components/StatusCard'

export function serviceTone(state: ServiceState): StatusTone {
  if (state === 'running') return 'ok'
  if (state === 'stopped') return 'warn'
  if (state === 'error') return 'bad'
  return 'unknown'
}

export function serviceLabel(state: ServiceState): string {
  if (state === 'running') return 'Running'
  if (state === 'stopped') return 'Stopped'
  if (state === 'error') return 'Error'
  return 'Unknown'
}
