import type { ScriptResult } from '@shared/scriptContract'

export type SystemPorts = Record<string, { port?: number; free?: boolean }>

export interface ParsedSystemDetails {
  osCaption?: string
  osBuild?: number
  ramBytes?: number
  diskCFreeBytes?: number | null
  ports?: SystemPorts
  cpuName?: string
  cpuPhysicalCores?: number
  /** Logical processors (threads); used for CPU-only Ollama and host-side load hints. */
  cpuLogicalProcessors?: number
}

export interface ParsedGpuDetails {
  gpuName?: string | null
  vramMb?: number | null
  vramGb?: number | null
  driverVersion?: string | null
  detection?: string | null
  readiness?: string
  readinessLabel?: string
}

export function parseSystemDetails(r: ScriptResult | null | undefined): ParsedSystemDetails {
  const d = r?.details
  if (!d || typeof d !== 'object') return {}
  const o = d as Record<string, unknown>
  return {
    osCaption: typeof o.osCaption === 'string' ? o.osCaption : undefined,
    osBuild: typeof o.osBuild === 'number' ? o.osBuild : undefined,
    ramBytes: typeof o.ramBytes === 'number' ? o.ramBytes : undefined,
    diskCFreeBytes: typeof o.diskCFreeBytes === 'number' ? o.diskCFreeBytes : o.diskCFreeBytes === null ? null : undefined,
    ports: o.ports && typeof o.ports === 'object' ? (o.ports as SystemPorts) : undefined,
    cpuName: typeof o.cpuName === 'string' && o.cpuName.trim().length > 0 ? o.cpuName.trim() : undefined,
    cpuPhysicalCores: typeof o.cpuPhysicalCores === 'number' && o.cpuPhysicalCores > 0 ? o.cpuPhysicalCores : undefined,
    cpuLogicalProcessors:
      typeof o.cpuLogicalProcessors === 'number' && o.cpuLogicalProcessors > 0 ? o.cpuLogicalProcessors : undefined
  }
}

export function parseGpuDetails(r: ScriptResult | null | undefined): ParsedGpuDetails {
  const d = r?.details
  if (!d || typeof d !== 'object') return {}
  const o = d as Record<string, unknown>
  return {
    gpuName: typeof o.gpuName === 'string' ? o.gpuName : undefined,
    vramMb: typeof o.vramMb === 'number' ? o.vramMb : undefined,
    vramGb: typeof o.vramGb === 'number' ? o.vramGb : undefined,
    driverVersion: typeof o.driverVersion === 'string' ? o.driverVersion : undefined,
    detection: typeof o.detection === 'string' ? o.detection : undefined,
    readiness: typeof o.readiness === 'string' ? o.readiness : undefined,
    readinessLabel: typeof o.readinessLabel === 'string' ? o.readinessLabel : undefined
  }
}
