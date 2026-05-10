import type { ScriptResult } from './scriptContract'

/** Steps we never persist as done — only success / warning / error get written. */
export type PersistableWizardOutcome = Exclude<
  ScriptResult['status'],
  'pending' | 'running'
>

/** Status chip when `state` is success/warning (null means show default “Done”). */
export type CompletionChipKind =
  | 'installed'
  | 'verified'
  | 'configured'
  | 'ready'
  | 'ok'
  | null

export interface PersistedWizardStep {
  state: PersistableWizardOutcome
  message: string
  /** Short label for StepCard subtitle (Docker server version, model id, …). */
  version?: string | null
  /** Status chip beside the step title (“Installed”, “Verified”, …). */
  completionChip?: CompletionChipKind
  recordedAt: string
}

/** Last outcome of `install-comfyui-portable.ps1` (shown under Comfy extras). */
export type PersistedPortableComfy = PersistedWizardStep & { variant?: string }

export interface WizardInstallPersisted {
  schemaVersion: 1
  /** Keyed by wizard step id (e.g. `docker`, `ollama`). */
  core: Partial<Record<string, PersistedWizardStep>>
  optional: Partial<Record<string, PersistedWizardStep>>
  portableComfy?: PersistedPortableComfy | null
}

export function emptyWizardInstallState(): WizardInstallPersisted {
  return { schemaVersion: 1, core: {}, optional: {}, portableComfy: undefined }
}

function isPersistableOutcome(v: unknown): v is PersistableWizardOutcome {
  return v === 'success' || v === 'warning' || v === 'error'
}

function isCompletionChip(v: unknown): v is CompletionChipKind {
  return v === null || v === 'installed' || v === 'verified' || v === 'configured' || v === 'ready' || v === 'ok'
}

function pickStep(raw: unknown): PersistedWizardStep | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (!isPersistableOutcome(o.state)) return null
  const message = typeof o.message === 'string' ? o.message : ''
  const recordedAt = typeof o.recordedAt === 'string' ? o.recordedAt : new Date(0).toISOString()
  const version =
    o.version === null || o.version === undefined
      ? null
      : typeof o.version === 'string'
        ? o.version
        : String(o.version)
  let completionChip: CompletionChipKind | undefined = undefined
  if ('completionChip' in o && isCompletionChip(o.completionChip)) completionChip = o.completionChip ?? null
  return {
    state: o.state,
    message,
    version: version && version.trim() ? version : null,
    ...(completionChip !== undefined ? { completionChip } : {}),
    recordedAt
  }
}

function stepsMap(raw: unknown): Partial<Record<string, PersistedWizardStep>> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Partial<Record<string, PersistedWizardStep>> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const s = pickStep(v)
    if (s) out[k] = s
  }
  return out
}

function portableCoerce(raw: unknown): PersistedPortableComfy | null {
  const s = pickStep(raw)
  if (!s) return null
  const extra = raw as Record<string, unknown>
  const variant = typeof extra.variant === 'string' ? extra.variant : undefined
  return variant !== undefined ? Object.assign(s, { variant }) : (s as PersistedPortableComfy)
}

/** Validates and fills defaults so renderer + main agree on shape. */
export function sanitizeWizardInstallState(raw: unknown): WizardInstallPersisted {
  if (!raw || typeof raw !== 'object') return emptyWizardInstallState()
  const o = raw as Record<string, unknown>
  const ver = o.schemaVersion
  const base = emptyWizardInstallState()
  const schemaOk = typeof ver === 'number' ? Math.floor(ver) === 1 : ver === undefined
  if (!schemaOk) return base

  const portableRaw = o.portableComfy
  const portable =
    portableRaw === undefined
      ? undefined
      : portableRaw === null
        ? null
        : portableCoerce(portableRaw) ?? undefined

  return {
    schemaVersion: 1,
    core: stepsMap(o.core),
    optional: stepsMap(o.optional),
    portableComfy: portable === undefined ? undefined : portable
  }
}

function str(d: Record<string, unknown>, key: string): string | undefined {
  const v = d[key]
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}

/** Human-sized image pointer (drop registry digest noise). */
function shortImageRef(image: string): string {
  const t = image.trim()
  const at = t.indexOf('@')
  const sansDigest = at >= 0 ? t.slice(0, at) : t
  const slash = sansDigest.lastIndexOf('/')
  const tail = slash >= 0 ? sansDigest.slice(slash + 1) : sansDigest
  return tail.length > 96 ? `${tail.slice(0, 95)}…` : tail
}

function shorten(text: string, max = 64): string {
  const s = text.trim()
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`
}

/** Derives one-line subtitle for persisted JSON + UI badges from a script outcome. */
export function wizardStepVersionSubtitle(
  stepId: string,
  r: ScriptResult,
  opts?: { wizardOllamaMissingOnly?: boolean; wizardGpuMissingOnly?: boolean }
): string | undefined {
  const wizardOk = !!(opts?.wizardOllamaMissingOnly ?? false) || !!(opts?.wizardGpuMissingOnly ?? false)
  if (!r.ok && !wizardOk) return undefined

  const d =
    typeof r.details === 'object' && r.details !== null
      ? (r.details as Record<string, unknown>)
      : {}

  switch (stepId) {
    case 'system':
      return str(d, 'osBuild') ? `Build ${String(d.osBuild)}` : str(d, 'osCaption')
    case 'gpu': {
      if (opts?.wizardGpuMissingOnly) {
        const label = str(d, 'readinessLabel')
        return label ? shorten(label, 72) : 'No NVIDIA GPU (CPU-only stack)'
      }
      const nam = str(d, 'gpuName')
      const dr = str(d, 'driverVersion')
      if (nam && dr) return shorten(`${nam} · driver ${dr}`, 72)
      return dr ?? (nam ? shorten(nam, 72) : undefined)
    }
    case 'ollama-check':
    case 'ollama':
      return str(d, 'ollamaVersion') ?? str(d, 'path')
    case 'docker-install':
    case 'docker':
      return str(d, 'serverVersion')
    case 'openwebui': {
      const img = str(d, 'containerImage')
      if (img) return shortImageRef(img)
      return str(d, 'container')
    }
    case 'models':
      return str(d, 'model')
    case 'cfg-ow':
      return str(d, 'openWebUiUrl')
    case 'cfg-comfy':
      return str(d, 'workflowsDir')
    case 'comfy':
      return str(d, 'url')
    default:
      return undefined
  }
}

export function inferCompletionChip(
  stepId: string,
  r: ScriptResult,
  opts?: { wizardOllamaMissingOnly?: boolean; wizardGpuMissingOnly?: boolean }
): CompletionChipKind {
  if (
    opts?.wizardOllamaMissingOnly &&
    stepId === 'ollama-check' &&
    !r.ok &&
    r.errors.some((e) => e.code === 'OLLAMA_NOT_FOUND')
  ) {
    return 'verified'
  }
  if (
    opts?.wizardGpuMissingOnly &&
    stepId === 'gpu' &&
    !r.ok &&
    r.errors.some((e) => e.code === 'NVIDIA_NOT_FOUND')
  ) {
    return 'verified'
  }

  switch (stepId) {
    case 'system':
    case 'gpu':
    case 'ollama-check':
    case 'docker':
      return 'verified'
    case 'ollama':
    case 'docker-install':
    case 'openwebui': {
      if (!r.ok) return null
      return 'installed'
    }
    case 'models':
      return 'ready'
    case 'cfg-ow':
    case 'cfg-comfy':
      return 'configured'
    case 'health':
      return 'ok'
    case 'comfy':
      return 'verified'
    default:
      return null
  }
}

export function completionChipKindToLabel(chip: CompletionChipKind): string | null {
  if (!chip) return null
  const map: Record<Exclude<CompletionChipKind, null>, string> = {
    installed: 'Installed',
    verified: 'Verified',
    configured: 'Configured',
    ready: 'Ready',
    ok: 'OK'
  }
  return map[chip] ?? null
}

export function persistedStepFromResult(args: {
  stepId: string
  persistState: PersistableWizardOutcome
  message: string
  result: ScriptResult
  wizardOllamaMissingOnly?: boolean
  wizardGpuMissingOnly?: boolean
  completionChipOverride?: CompletionChipKind
}): PersistedWizardStep {
  const version =
    wizardStepVersionSubtitle(args.stepId, args.result, {
      wizardOllamaMissingOnly: args.wizardOllamaMissingOnly,
      wizardGpuMissingOnly: args.wizardGpuMissingOnly
    }) ?? null
  const inferred = inferCompletionChip(args.stepId, args.result, {
    wizardOllamaMissingOnly: args.wizardOllamaMissingOnly,
    wizardGpuMissingOnly: args.wizardGpuMissingOnly
  })

  /** When script errored/warned, avoid “Installed” copy unless probe already satisfied. */
  let completionChip =
    args.completionChipOverride ??
    (args.persistState === 'success' ||
    args.persistState === 'warning' ||
    (args.stepId === 'ollama-check' && !!args.wizardOllamaMissingOnly) ||
    (args.stepId === 'gpu' && !!args.wizardGpuMissingOnly)
      ? inferred
      : null)

  if (args.persistState === 'warning' || args.persistState === 'error') {
    completionChip = null
  }
  return {
    state: args.persistState,
    message: args.message,
    version,
    completionChip,
    recordedAt: new Date().toISOString()
  }
}
