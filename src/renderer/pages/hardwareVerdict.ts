import type { HardwareScanPayload } from '@shared/preloadApi'
import type { ParsedGpuDetails, ParsedSystemDetails } from './hardwareTypes'

export type VerdictKind = 'go' | 'caution' | 'hold'

export type VerdictLineStatus = 'ok' | 'warn' | 'bad'

export interface VerdictLine {
  name: string
  status: VerdictLineStatus
  text: string
}

export interface HardwareVerdictView {
  kind: VerdictKind
  badge: string
  headline: string
  explanation: string
  lines: VerdictLine[]
  footnote: string
}

const RAM_GO_BYTES = 8 * 1024 ** 3

function anyPortBusy(sys: ParsedSystemDetails): boolean {
  const p = sys.ports
  if (!p || typeof p !== 'object') return false
  return Object.values(p).some((x) => x && x.free === false)
}

function hasLowRamWarning(system: HardwareScanPayload['system']): boolean {
  if (!system?.warnings?.length) return false
  return system.warnings.some((w) => /8\s*GB|RAM/i.test(w))
}

function hasLowDiskWarning(system: HardwareScanPayload['system']): boolean {
  if (!system?.warnings?.length) return false
  return system.warnings.some((w) => /50\s*GB|free on C/i.test(w))
}

function ramBytesLow(sys: ParsedSystemDetails): boolean {
  return typeof sys.ramBytes === 'number' && sys.ramBytes > 0 && sys.ramBytes < RAM_GO_BYTES
}

function buildStackLines(params: {
  unsupported: boolean
  tierBasic: boolean
  tierOk: boolean
  lowRam: boolean
  lowDisk: boolean
  portsBusy: boolean
  gpuOk: boolean
}): VerdictLine[] {
  const { unsupported, tierBasic, tierOk, lowRam, lowDisk, portsBusy, gpuOk } = params
  const lines: VerdictLine[] = []

  if (unsupported) {
    lines.push({
      name: 'Ollama (local LLM)',
      status: lowRam ? 'bad' : 'warn',
      text: lowRam
        ? 'CPU-only inference with under 8 GB RAM — use very small / quantized models only; expect sluggish chat.'
        : 'Runs on CPU without NVIDIA; choose smaller models and expect slower responses than on a GPU PC.'
    })
  } else if (tierBasic) {
    lines.push({
      name: 'Ollama (local LLM)',
      status: 'warn',
      text: 'NVIDIA is present but VRAM looks tight or unknown — prefer modest model sizes and watch RAM if Docker is running too.'
    })
  } else if (lowRam) {
    lines.push({
      name: 'Ollama (local LLM)',
      status: 'warn',
      text: 'GPU helps, but under 8 GB system RAM — close other apps and avoid huge models at the same time as Docker.'
    })
  } else if (tierOk && gpuOk) {
    lines.push({
      name: 'Ollama (local LLM)',
      status: 'ok',
      text: 'Good fit for local chat models with GPU acceleration.'
    })
  } else {
    lines.push({
      name: 'Ollama (local LLM)',
      status: 'warn',
      text: 'GPU scan completed with an unusual tier — still try modest models first.'
    })
  }

  let webStatus: VerdictLineStatus = 'ok'
  let webText = 'Docker Desktop + browser UI are a reasonable load on this hardware.'
  if (portsBusy) {
    webStatus = 'warn'
    webText =
      'A default port is already in use — you can install, but fix the conflict or adjust ports in config before relying on Open WebUI.'
  }
  if (lowDisk) {
    webStatus = 'warn'
    webText = portsBusy
      ? `${webText} Also free more space on C: before pulling large images.`
      : 'Free more space on C: before pulling Docker images; disk looks tight for a growing stack.'
  }
  if (lowRam) {
    webStatus = 'warn'
    webText =
      'Docker Desktop + browser are heavy with under 8 GB RAM — expect swapping unless you keep the stack minimal.'
  }
  if (unsupported && lowRam) {
    webStatus = 'bad'
    webText =
      'Docker + browser on this RAM without GPU offload is a stretch — only proceed if you keep services very light or add RAM.'
  }
  lines.push({ name: 'Open WebUI (Docker)', status: webStatus, text: webText })

  if (unsupported) {
    lines.push({
      name: 'ComfyUI / GPU images',
      status: 'bad',
      text: 'NVIDIA CUDA workflows from this launcher are not a match — skip GPU-heavy Comfy installs or use another machine.'
    })
  } else if (tierBasic) {
    lines.push({
      name: 'ComfyUI / GPU images',
      status: 'warn',
      text: 'Limited VRAM — image workflows may fail on large checkpoints; fine for light experiments.'
    })
  } else if (tierOk && gpuOk) {
    lines.push({
      name: 'ComfyUI / GPU images',
      status: 'ok',
      text: 'VRAM tier looks workable for typical local GPU Comfy runs.'
    })
  } else {
    lines.push({
      name: 'ComfyUI / GPU images',
      status: 'warn',
      text: 'Treat GPU image workflows cautiously until you confirm VRAM headroom in practice.'
    })
  }

  return lines
}

/** Interprets Hardware Doctor scan for install guidance (go / caution / hold). */
export function buildHardwareVerdictView(
  last: HardwareScanPayload,
  sys: ParsedSystemDetails,
  gpu: ParsedGpuDetails,
  gpuOk: boolean
): HardwareVerdictView {
  const system = last.system
  const systemOk = system?.ok === true

  if (!systemOk) {
    return {
      kind: 'hold',
      badge: 'Blocked',
      headline: 'Fix the system check before installing',
      explanation:
        'The Windows / RAM / disk / ports scan did not finish successfully. Installing now may fail mid-way or leave a broken stack.',
      lines: [
        {
          name: 'What to do',
          status: 'bad',
          text: 'Use Troubleshooting or the raw JSON message, fix the underlying issue, then scan again.'
        }
      ],
      footnote: ''
    }
  }

  const readiness = (gpu.readiness ?? '').trim()
  const tierOk = gpuOk && ['recommended', 'creator', 'pro'].includes(readiness)
  const tierBasic = gpuOk && readiness === 'basic'
  const unsupported = !gpuOk || readiness === 'unsupported'

  const lowRam = hasLowRamWarning(system) || ramBytesLow(sys)
  const lowDisk = hasLowDiskWarning(system)
  const portsBusy = anyPortBusy(sys)

  const lines = buildStackLines({
    unsupported,
    tierBasic,
    tierOk,
    lowRam,
    lowDisk,
    portsBusy,
    gpuOk
  })

  const go = gpuOk && tierOk && !lowRam && !lowDisk && !portsBusy

  if (go) {
    return {
      kind: 'go',
      badge: 'Green light',
      headline: 'This PC matches the full PrivateAI install profile',
      explanation:
        'NVIDIA GPU tier, RAM, free disk on C:, and default ports look good for Ollama + Open WebUI + optional Comfy. Next step: run the Install wizard and pick the pieces you want.',
      lines,
      footnote: 'Real-world speed still depends on model size, thermal limits, and other apps running in the background.'
    }
  }

  const reasons: string[] = []
  if (unsupported) reasons.push('no NVIDIA GPU detected for this stack')
  if (lowRam) reasons.push('under 8 GB system RAM')
  if (lowDisk) reasons.push('limited free space on C:')
  if (portsBusy) reasons.push('a default service port is in use')
  if (tierBasic && gpuOk) reasons.push('borderline GPU VRAM')

  const onlyPortsBusy = portsBusy && gpuOk && tierOk && !lowRam && !lowDisk && !unsupported

  if (onlyPortsBusy) {
    return {
      kind: 'caution',
      badge: 'Heads-up',
      headline: 'Hardware looks strong — a default port is busy',
      explanation:
        'GPU, RAM, and disk are fine for this stack. Something is already listening on one of the default ports (often a previous install or another app). Use the checklist below, free or remap that port, then scan again for a green verdict.',
      lines,
      footnote: 'This is not a “weak PC” warning — it is only about port availability.'
    }
  }

  return {
    kind: 'caution',
    badge: 'Yellow light',
    headline: 'Install only what this machine can carry',
    explanation: `Use the checklist below as your go / no-go for each product.${
      reasons.length ? ` Highlights: ${reasons.join('; ')}.` : ''
    } Then open Install — skip or postpone options marked red or yellow.`,
    lines,
    footnote: 'Re-scan after adding RAM, freeing disk, installing NVIDIA drivers, or freeing busy ports.'
  }
}
