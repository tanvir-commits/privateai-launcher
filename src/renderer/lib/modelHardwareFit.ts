import type { HardwareScanPayload } from '@shared/preloadApi'
import type { ScriptResult } from '@shared/scriptContract'
import type { ParsedGpuDetails } from '../pages/hardwareTypes'
import { parseGpuDetails, parseSystemDetails } from '../pages/hardwareTypes'

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
  /**
   * Optional stricter floor for logical CPU threads when Ollama runs on CPU only **and** the suggested pull
   * equals this card’s primary `ollamaPull`. Substitute pulls use thread rules inferred from the substitute tag.
   */
  minLogicalProcessorsCpu?: number
  /**
   * When an NVIDIA GPU is present, warn / soften fit if logical threads fall below this.
   * When omitted, inferred from the catalog `ollamaPull` tag.
   */
  minLogicalProcessorsGpu?: number
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

/** Heuristic minimum logical CPU threads for a given Ollama tag (CPU-only or GPU host load). */
export function inferredMinLogicalForOllamaTag(pull: string): number {
  const t = pull.toLowerCase()
  if (/\b(0\.5b|1b|1\.8b|2b|3b|smoll|tiny|mini)\b/.test(t) || /(^|[:\-])3b\b/.test(t) || t.endsWith(':3b')) return 4
  if (/\b(7b|8b|9b)\b/.test(t) || /(^|[:\-])7b\b/.test(t) || t.endsWith(':7b')) return 8
  if (/\b(13b|14b|20b|32b|65b|70b)\b/.test(t)) return 12
  return 6
}

function minLogicalCpuInference(profile: ModelProfileRow, effectivePull: string): number {
  const inferred = inferredMinLogicalForOllamaTag(effectivePull)
  const override =
    typeof profile.minLogicalProcessorsCpu === 'number' && profile.minLogicalProcessorsCpu > 0
      ? profile.minLogicalProcessorsCpu
      : null
  if (override !== null && profile.ollamaPull && effectivePull === profile.ollamaPull) {
    return Math.max(inferred, override)
  }
  return inferred
}

function minLogicalGpuHost(profile: ModelProfileRow): number {
  const pull = profile.ollamaPull
  if (typeof profile.minLogicalProcessorsGpu === 'number' && profile.minLogicalProcessorsGpu > 0) {
    return profile.minLogicalProcessorsGpu
  }
  if (pull) return inferredMinLogicalForOllamaTag(pull)
  return 6
}

function applyCpu(profile: ModelProfileRow, scan: HardwareScanPayload | null, fit: ModelProfileFit): ModelProfileFit {
  if (!scan || !scan.system?.ok) return fit
  const sys = parseSystemDetails(scan.system)
  const gpuOk = scan.gpu?.ok === true
  const L = sys.cpuLogicalProcessors ?? null

  let { label, hint, sortKey, effectivePull } = fit
  const cpuOnlyText = !gpuOk && profile.ollamaPull !== null && !requiresNvidia(profile)

  if (cpuOnlyText && effectivePull) {
    const minL = minLogicalCpuInference(profile, effectivePull)
    const threads = L ?? 4
    if (threads < minL) {
      sortKey -= threads < 4 ? 28 : 12
      if (threads < 4) {
        label = 'tight'
        hint += ` Only ${threads} CPU thread(s) reported — ${effectivePull} on CPU will be very slow; use the smallest models and close heavy apps.`
      } else {
        if (label === 'ideal') label = 'ok'
        hint += ` ${threads} CPU thread(s) — for CPU-only chat we like at least ~${minL} for this pull; expect slower tokens than on a stronger CPU.`
      }
    }
  }

  if (gpuOk && L !== null && L < minLogicalGpuHost(profile) && profile.ollamaPull) {
    sortKey -= 8
    if (label === 'ideal') label = 'ok'
    hint += ` Few CPU threads (${L}) — the GPU runs the model, but prompt handling and the rest of Windows still use the CPU; large tags can feel sluggish.`
  }

  if (!profile.ollamaPull && gpuOk && L !== null && L < 6) {
    sortKey -= 6
    hint += ` ${L} CPU thread(s) — Comfy previews and preprocessing still lean on the host CPU.`
  }

  return {
    label,
    effectivePull,
    hint: hint.trim(),
    sortKey
  }
}

export function buildModelProfileFit(
  profile: ModelProfileRow,
  scan: HardwareScanPayload | null
): ModelProfileFit {
  if (!scan || scan.error) {
    return applyCpu(profile, scan, {
      label: 'ok',
      effectivePull: profile.ollamaPull,
      hint: 'Run Check my PC once to sort these for your GPU, CPU, and RAM.',
      sortKey: 0
    })
  }

  if (!scan.system?.ok) {
    return applyCpu(profile, scan, {
      label: 'blocked',
      effectivePull: profile.ollamaPull,
      hint: 'System check did not succeed — fix Check my PC before pulling large models.',
      sortKey: -100
    })
  }

  const gpu = parseGpuDetails(scan.gpu ?? undefined)
  const gpuOk = scan.gpu?.ok === true
  const ramGb = ramGbFromSystem(scan.system)
  const vramGb = gpuOk ? vramGbFromGpu(gpu) : null
  const needRam = minRamGb(profile)
  const needVram = minVramGb(profile)
  const ramOk = ramGb === null || ramGb >= needRam - 0.25

  if (!ramOk) {
    return applyCpu(profile, scan, {
      label: 'tight',
      effectivePull: profile.ollamaPull,
      hint: `This profile expects about ${needRam} GB system RAM — close other apps or add RAM before large pulls.`,
      sortKey: 15
    })
  }

  if (!profile.ollamaPull) {
    const nv = requiresNvidia(profile)
    if (nv && !gpuOk) {
      return applyCpu(profile, scan, {
        label: 'blocked',
        effectivePull: null,
        hint: 'Needs an NVIDIA GPU for the GPU image workflows this card refers to.',
        sortKey: -80
      })
    }
    if (nv && vramGb !== null && vramGb < needVram) {
      return applyCpu(profile, scan, {
        label: 'tight',
        effectivePull: null,
        hint: `VRAM looks below ~${needVram} GB — Comfy / large checkpoints may fail; still fine to manage files manually.`,
        sortKey: 25
      })
    }
    return applyCpu(profile, scan, {
      label: gpuOk && vramGb !== null && vramGb >= needVram ? 'ideal' : 'ok',
      effectivePull: null,
      hint: gpuOk ? 'Hardware looks sufficient for typical local Comfy runs.' : 'GPU scan unavailable — treat GPU workflows cautiously.',
      sortKey: gpuOk ? 70 : 40
    })
  }

  if (requiresNvidia(profile) && !gpuOk) {
    return applyCpu(profile, scan, {
      label: 'blocked',
      effectivePull: null,
      hint: 'Vision models need a working NVIDIA GPU in this stack.',
      sortKey: -90
    })
  }

  if (!gpuOk) {
    const fb = profile.cpuFallbackPull?.trim()
    if (fb) {
      return applyCpu(profile, scan, {
        label: 'substitute',
        effectivePull: fb,
        hint: `No NVIDIA GPU detected — pulling smaller chat model \`${fb}\` instead of \`${profile.ollamaPull}\`.`,
        sortKey: 55
      })
    }
    return applyCpu(profile, scan, {
      label: 'blocked',
      effectivePull: null,
      hint: 'No NVIDIA GPU — this tag is not recommended on CPU; try a tiny model from the library or upgrade hardware.',
      sortKey: -70
    })
  }

  if (vramGb === null) {
    const fb = profile.cpuFallbackPull?.trim()
    return applyCpu(profile, scan, {
      label: 'ok',
      effectivePull: profile.ollamaPull,
      hint: fb
        ? `VRAM size unknown — if chat feels slow or OOMs, try \`${fb}\` instead.`
        : 'VRAM size unknown — start with this tag; move down in size if chat is slow.',
      sortKey: 45
    })
  }

  if (vramGb >= needVram + 2) {
    return applyCpu(profile, scan, {
      label: 'ideal',
      effectivePull: profile.ollamaPull,
      hint: `VRAM (~${vramGb.toFixed(1)} GB) has comfortable headroom for this tag.`,
      sortKey: 100
    })
  }

  if (vramGb >= needVram) {
    return applyCpu(profile, scan, {
      label: 'ok',
      effectivePull: profile.ollamaPull,
      hint: `VRAM (~${vramGb.toFixed(1)} GB) meets the ~${needVram} GB we suggest for this tag.`,
      sortKey: 80
    })
  }

  const fb = profile.cpuFallbackPull?.trim()
  if (fb) {
    return applyCpu(profile, scan, {
      label: 'substitute',
      effectivePull: fb,
      hint: `VRAM (~${vramGb.toFixed(1)} GB) is tight for \`${profile.ollamaPull}\` — we suggest pulling \`${fb}\` first.`,
      sortKey: 60
    })
  }

  return applyCpu(profile, scan, {
    label: 'tight',
    effectivePull: profile.ollamaPull,
    hint: `VRAM (~${vramGb.toFixed(1)} GB) is below the ~${needVram} GB we like for this tag — expect slowdowns or OOM; consider a smaller model from the library.`,
    sortKey: 30
  })
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
  const sys = parseSystemDetails(scan.system)
  const gpu = parseGpuDetails(scan.gpu ?? undefined)
  const gpuOk = scan.gpu?.ok === true
  const ramGb = ramGbFromSystem(scan.system)
  const vramGb = gpuOk ? vramGbFromGpu(gpu) : null
  const parts: string[] = []
  if (ramGb !== null) parts.push(`${ramGb.toFixed(1)} GB RAM`)
  if (typeof sys.cpuLogicalProcessors === 'number' && sys.cpuLogicalProcessors > 0) {
    const phys =
      typeof sys.cpuPhysicalCores === 'number' && sys.cpuPhysicalCores > 0
        ? `${sys.cpuPhysicalCores}c/${sys.cpuLogicalProcessors}t`
        : `${sys.cpuLogicalProcessors} threads`
    parts.push(phys)
  }
  if (gpuOk) {
    if (vramGb !== null) parts.push(`~${vramGb.toFixed(1)} GB VRAM`)
    if (gpu.readiness) parts.push(String(gpu.readiness))
  } else {
    parts.push('no NVIDIA GPU detected for this scan')
  }
  return parts.join(' · ')
}
