import type { HardwareScanPayload } from '@shared/preloadApi'
import type { ScriptResult } from '@shared/scriptContract'
import type { ParsedGpuDetails } from '../pages/hardwareTypes'
import { parseGpuDetails } from '../pages/hardwareTypes'

export interface ModelProfileRow {
  id: string
  label: string
  description: string
  ollamaPull: string | null
  approxSizeGb?: number | null
  /** Minimum dedicated VRAM (GB) for the primary `ollamaPull`. Use 0 if any NVIDIA VRAM is fine. */
  minVramGb?: number
  /** Minimum system RAM (GB). Defaults to 8 when omitted. */
  minRamGb?: number
  /** When there is no usable NVIDIA GPU or VRAM is below `minVramGb`, pull this smaller model instead (text profiles only). */
  cpuFallbackPull?: string | null
  /** If true, profile is meaningless without an NVIDIA-class stack (e.g. vision). */
  requiresNvidia?: boolean
}

export type ModelFitLabel = 'ideal' | 'ok' | 'substitute' | 'tight' | 'blocked'

export interface ModelProfileFit {
  label: ModelFitLabel
  /** Pull tag to use from this launcher (may differ from catalog `ollamaPull`). */
  effectivePull: string | null
  /** Short reason shown under the card title. */
  hint: string
  /** Sort descending: better matches for this PC first. */
  sortKey: number
}

const DEFAULT_MIN_RAM_GB = 8

function ramGbFromSystem(system: ScriptResult | null | undefined): number | null {
  const d = system?.details
  if (!d || typeof d !== 'object') return null
  const b = (d as Record<string, unknown>).ramBytes
  if (typeof b !== 'number' || b <= 0) return null
  return b / 1024 ** 3
}

function vramGbFromGpu(gpu: ParsedGpuDetails): number | null {
  if (typeof gpu.vramGb === 'number' && gpu.vramGb > 0) return gpu.vramGb
  if (typeof gpu.vramMb === 'number' && gpu.vramMb > 0) return gpu.vramMb / 1024
  return null
}

function minRamGb(p: ModelProfileRow): number {
  return typeof p.minRamGb === 'number' && p.minRamGb > 0 ? p.minRamGb : DEFAULT_MIN_RAM_GB
}

function minVramGb(p: ModelProfileRow): number {
  if (typeof p.minVramGb === 'number' && p.minVramGb >= 0) return p.minVramGb
  if (p.ollamaPull) return 6
  return 0
}

function requiresNvidia(p: ModelProfileRow): boolean {
  return p.requiresNvidia === true
}

export function buildModelProfileFit(
  profile: ModelProfileRow,
  scan: HardwareScanPayload | null
): ModelProfileFit {
  if (!scan || scan.error) {
    return {
      label: 'ok',
      effectivePull: profile.ollamaPull,
      hint: 'Run Check my PC once to sort these for your GPU and RAM.',
      sortKey: 0
    }
  }

  if (!scan.system?.ok) {
    return {
      label: 'blocked',
      effectivePull: profile.ollamaPull,
      hint: 'System check did not succeed — fix Check my PC before pulling large models.',
      sortKey: -100
    }
  }

  const gpu = parseGpuDetails(scan.gpu ?? undefined)
  const gpuOk = scan.gpu?.ok === true
  const ramGb = ramGbFromSystem(scan.system)
  const vramGb = gpuOk ? vramGbFromGpu(gpu) : null
  const needRam = minRamGb(profile)
  const needVram = minVramGb(profile)
  const ramOk = ramGb === null || ramGb >= needRam - 0.25

  if (!ramOk) {
    return {
      label: 'tight',
      effectivePull: profile.ollamaPull,
      hint: `This profile expects about ${needRam} GB system RAM — close other apps or add RAM before large pulls.`,
      sortKey: 15
    }
  }

  if (!profile.ollamaPull) {
    const nv = requiresNvidia(profile)
    if (nv && !gpuOk) {
      return {
        label: 'blocked',
        effectivePull: null,
        hint: 'Needs an NVIDIA GPU for the GPU image workflows this card refers to.',
        sortKey: -80
      }
    }
    if (nv && vramGb !== null && vramGb < needVram) {
      return {
        label: 'tight',
        effectivePull: null,
        hint: `VRAM looks below ~${needVram} GB — Comfy / large checkpoints may fail; still fine to manage files manually.`,
        sortKey: 25
      }
    }
    return {
      label: gpuOk && vramGb !== null && vramGb >= needVram ? 'ideal' : 'ok',
      effectivePull: null,
      hint: gpuOk ? 'Hardware looks sufficient for typical local Comfy runs.' : 'GPU scan unavailable — treat GPU workflows cautiously.',
      sortKey: gpuOk ? 70 : 40
    }
  }

  if (requiresNvidia(profile) && !gpuOk) {
    return {
      label: 'blocked',
      effectivePull: null,
      hint: 'Vision models need a working NVIDIA GPU in this stack.',
      sortKey: -90
    }
  }

  if (!gpuOk) {
    const fb = profile.cpuFallbackPull?.trim()
    if (fb) {
      return {
        label: 'substitute',
        effectivePull: fb,
        hint: `No NVIDIA GPU detected — pulling smaller chat model \`${fb}\` instead of \`${profile.ollamaPull}\`.`,
        sortKey: 55
      }
    }
    return {
      label: 'blocked',
      effectivePull: null,
      hint: 'No NVIDIA GPU — this tag is not recommended on CPU; try a tiny model from the library or upgrade hardware.',
      sortKey: -70
    }
  }

  if (vramGb === null) {
    const fb = profile.cpuFallbackPull?.trim()
    return {
      label: 'ok',
      effectivePull: profile.ollamaPull,
      hint: fb
        ? `VRAM size unknown — if chat feels slow or OOMs, try \`${fb}\` instead.`
        : 'VRAM size unknown — start with this tag; move down in size if chat is slow.',
      sortKey: 45
    }
  }

  if (vramGb >= needVram + 2) {
    return {
      label: 'ideal',
      effectivePull: profile.ollamaPull,
      hint: `VRAM (~${vramGb.toFixed(1)} GB) has comfortable headroom for this tag.`,
      sortKey: 100
    }
  }

  if (vramGb >= needVram) {
    return {
      label: 'ok',
      effectivePull: profile.ollamaPull,
      hint: `VRAM (~${vramGb.toFixed(1)} GB) meets the ~${needVram} GB we suggest for this tag.`,
      sortKey: 80
    }
  }

  const fb = profile.cpuFallbackPull?.trim()
  if (fb) {
    return {
      label: 'substitute',
      effectivePull: fb,
      hint: `VRAM (~${vramGb.toFixed(1)} GB) is tight for \`${profile.ollamaPull}\` — we suggest pulling \`${fb}\` first.`,
      sortKey: 60
    }
  }

  return {
    label: 'tight',
    effectivePull: profile.ollamaPull,
    hint: `VRAM (~${vramGb.toFixed(1)} GB) is below the ~${needVram} GB we like for this tag — expect slowdowns or OOM; consider a smaller model from the library.`,
    sortKey: 30
  }
}

export function sortProfilesByHardwareFit(
  profiles: ModelProfileRow[],
  scan: HardwareScanPayload | null
): { profile: ModelProfileRow; fit: ModelProfileFit }[] {
  const decorated = profiles.map((profile) => ({
    profile,
    fit: buildModelProfileFit(profile, scan)
  }))
  return decorated.sort((a, b) => {
    const d = b.fit.sortKey - a.fit.sortKey
    if (d !== 0) return d
    return a.profile.id.localeCompare(b.profile.id)
  })
}

export function hardwareSummaryLine(scan: HardwareScanPayload | null): string | null {
  if (!scan || scan.error) return null
  if (!scan.system?.ok) return null
  const gpu = parseGpuDetails(scan.gpu ?? undefined)
  const gpuOk = scan.gpu?.ok === true
  const ramGb = ramGbFromSystem(scan.system)
  const vramGb = gpuOk ? vramGbFromGpu(gpu) : null
  const parts: string[] = []
  if (ramGb !== null) parts.push(`${ramGb.toFixed(1)} GB RAM`)
  if (gpuOk) {
    if (vramGb !== null) parts.push(`~${vramGb.toFixed(1)} GB VRAM`)
    if (gpu.readiness) parts.push(String(gpu.readiness))
  } else {
    parts.push('no NVIDIA GPU detected for this scan')
  }
  return parts.join(' · ')
}
