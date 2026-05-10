import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import modelProfiles from '@config/model-profiles.json'
import type { ScriptResult } from '@shared/scriptContract'
import type { ScriptProgressEvent } from '@shared/scriptProgress'
import {
  emptyWizardInstallState,
  persistedStepFromResult,
  type CompletionChipKind,
  type PersistableWizardOutcome,
  type PersistedPortableComfy,
  type WizardInstallPersisted
} from '@shared/wizardInstallPersist'
import { ActionButton } from '../components/ActionButton'
import { LogPanel } from '../components/LogPanel'
import { StepCard, type StepScriptProgress, type StepState } from '../components/StepCard'

/** Same UI payload within this window skips a React update (fewer expensive re-renders during install). */
function progressThrottleCoalesce(ev: ScriptProgressEvent): string {
  return `${ev.phase}|${ev.percent ?? 'x'}|${ev.detail ?? ''}`
}

type ProgressThrottleGate = { at: number; sig: string }

function comfyPortableProgressLine(ev: ScriptProgressEvent | null): {
  caption: string
  barPct: number | null
  indeterminate: boolean
} {
  if (!ev) {
    return { caption: 'Preparing download...', barPct: null, indeterminate: true }
  }
  if (ev.phase === 'download') {
    if (ev.percent !== null) {
      return {
        caption: `Downloading Comfy (${ev.percent}% complete)`,
        barPct: ev.percent,
        indeterminate: false
      }
    }
    return {
      caption: 'Downloading Comfy…',
      barPct: null,
      indeterminate: true
    }
  }
  if (ev.phase === 'extract') {
    return { caption: 'Unpacking files…', barPct: null, indeterminate: true }
  }
  return {
    caption: 'Starting ComfyUI (first launch can take up to a few minutes)',
    barPct: null,
    indeterminate: true
  }
}

function humanizeCorePhase(phase: string): string {
  const map: Record<string, string> = {
    download: 'Downloading',
    extract: 'Unpacking',
    starting: 'Starting',
    install: 'Installing',
    winget: 'Package manager',
    preflight: 'Preparing system',
    wsl: 'WSL setup',
    checking: 'Checking',
    check: 'Verifying',
    configure: 'Configuring',
    waiting: 'Waiting'
  }
  if (map[phase]) return map[phase]
  return phase.length > 0 ? phase.charAt(0).toUpperCase() + phase.slice(1) : phase
}

/** Script progress shown inside the active step card (no duplicate title). */
function wizardStepScriptProgress(ev: ScriptProgressEvent | null): StepScriptProgress {
  const detail = ev?.detail?.trim() ? `: ${ev.detail}` : ''
  if (ev && typeof ev.percent === 'number') {
    return {
      caption: `${humanizeCorePhase(ev.phase)}${detail} (${ev.percent}%)`,
      barPct: ev.percent,
      indeterminate: false
    }
  }
  if (ev) {
    return {
      caption: `${humanizeCorePhase(ev.phase)}${detail}…`,
      barPct: null,
      indeterminate: true
    }
  }
  return {
    caption: 'Working…',
    barPct: null,
    indeterminate: true
  }
}

/** First profile with an Ollama tag — kept in sync with Models page starter recommendations. */
const WIZARD_STARTER_OLLAMA_MODEL =
  modelProfiles.profiles.find((p) => typeof p.ollamaPull === 'string' && p.ollamaPull.length > 0)
    ?.ollamaPull ?? 'qwen2.5:7b'

type WizardStep = {
  id: string
  title: string
  script?: string
  elevated?: boolean
  timeoutMs?: number
}

/** Steps everyone runs for chat + Open WebUI — no ComfyUI (optional). */
const CORE_STEPS: WizardStep[] = [
  { id: 'system', title: 'Check system', script: 'check-system.ps1' },
  { id: 'gpu', title: 'Check GPU', script: 'check-gpu.ps1' },
  { id: 'ollama-check', title: 'Check Ollama', script: 'check-ollama.ps1' },
  {
    id: 'ollama',
    title: 'Install / verify Ollama',
    script: 'install-ollama.ps1',
    timeoutMs: 900_000
  },
  {
    id: 'docker-install',
    title: 'Install / verify Docker Desktop (admin)',
    script: 'install-docker.ps1',
    elevated: true,
    timeoutMs: 900_000
  },
  {
    id: 'docker',
    title: 'Check Docker Desktop',
    script: 'check-docker.ps1',
    /** Must stay non-elevated: elevated wrapper can stall after progress hits 100% while JSON never returns. */
    elevated: false,
    timeoutMs: 1_800_000
  },
  { id: 'openwebui', title: 'Install / verify Open WebUI', script: 'install-openwebui.ps1' },
  {
    id: 'models',
    title: 'Download starter models',
    script: 'download-models.ps1',
    timeoutMs: 900_000
  },
  { id: 'cfg-ow', title: 'Configure Open WebUI', script: 'configure-openwebui.ps1' },
  { id: 'health', title: 'Run health check', script: 'health-check.ps1' }
]

/** Opt-in after core: optional portable download + ComfyUI probe + shipped workflow paths. */
const OPTIONAL_COMFY_STEPS: WizardStep[] = [
  {
    id: 'comfy',
    title: 'Check ComfyUI (optional)',
    script: 'install-comfyui.ps1'
  },
  { id: 'cfg-comfy', title: 'Configure ComfyUI integration', script: 'configure-comfyui.ps1' }
]

/** Probe-only installs: run fast checks instead of installers when dependency is ready. */
const INSTALL_PREFLIGHT_IDS = ['ollama', 'docker-install', 'openwebui'] as const

/** Status chip text while a step is running (installer UX). */
const RUNNING_STATUS_LABEL: Partial<Record<string, string>> = {
  ollama: 'Installing',
  'docker-install': 'Installing',
  docker: 'Checking',
  openwebui: 'Installing',
  comfy: 'Checking',
  models: 'Downloading',
  'cfg-ow': 'Configuring',
  'cfg-comfy': 'Configuring',
  health: 'Checking'
}

/** Secondary line while scripts run (replaces generic “Running script…”). */
const RUNNING_MESSAGE: Partial<Record<string, string>> = {
  system: 'Scanning system…',
  gpu: 'Checking GPU and drivers…',
  'ollama-check':
    'Checking Ollama. If it is installed but idle, PrivateAI tries to wake it automatically (up to ~90s)…',
  ollama:
    'Installing Ollama with winget when missing (downloads can take several minutes), then waiting for the API…',
  'docker-install':
    'Installing or verifying Docker Desktop (admin). If the engine already runs, this step finishes quickly; otherwise DISM/WSL/winget/ACL work can take 5–15+ minutes. Approve UAC. If Docker Desktop opens, finish any update or onboarding there first. Log lines every ~12s.',
  docker:
    'Waiting for the Docker engine. If needed we start com.docker.service or Docker Desktop only — the wizard does not run wsl --update or wsl --shutdown here (use Troubleshooting if Docker reports WSL). First install can still take several minutes.',
  openwebui: 'Installing or verifying Open WebUI…',
  comfy:
    'Checking if ComfyUI answers on localhost after install. Open WebUI only uses images if you connect an image backend in its admin.',
  models: `Downloading starter Ollama model (${WIZARD_STARTER_OLLAMA_MODEL}); size varies — can take many minutes.`,
  'cfg-ow': 'Applying Open WebUI configuration…',
  'cfg-comfy': 'Recording shipped Comfy workflow template paths…',
  health: 'Running health checks…'
}

function runningLine(step: WizardStep): string {
  if (step.id in RUNNING_MESSAGE) {
    return RUNNING_MESSAGE[step.id]!
  }
  return 'Running script…'
}

function stepStateToPersistedOutcome(state: StepState): PersistableWizardOutcome | null {
  if (state === 'pending' || state === 'running') return null
  return state
}

function hydrateCoreFromDisk(core: WizardInstallPersisted['core']): {
  states: StepState[]
  messages: string[]
  subtitles: (string | null)[]
  chips: (CompletionChipKind | null)[]
} {
  return {
    states: CORE_STEPS.map((s) => {
      const row = core[s.id]
      return row ? row.state : 'pending'
    }),
    messages: CORE_STEPS.map((s) => core[s.id]?.message ?? 'Waiting'),
    subtitles: CORE_STEPS.map((s) => core[s.id]?.version ?? null),
    chips: CORE_STEPS.map((s) => core[s.id]?.completionChip ?? null)
  }
}

function hydrateOptionalFromDisk(opt: WizardInstallPersisted['optional']): {
  states: StepState[]
  messages: string[]
  subtitles: (string | null)[]
  chips: (CompletionChipKind | null)[]
} {
  return {
    states: OPTIONAL_COMFY_STEPS.map((s) => {
      const row = opt[s.id]
      return row ? row.state : 'pending'
    }),
    messages: OPTIONAL_COMFY_STEPS.map((s) => opt[s.id]?.message ?? 'Optional — not run yet.'),
    subtitles: OPTIONAL_COMFY_STEPS.map((s) => opt[s.id]?.version ?? null),
    chips: OPTIONAL_COMFY_STEPS.map((s) => opt[s.id]?.completionChip ?? null)
  }
}

export default function InstallWizard() {
  const initialCore = useMemo(() => CORE_STEPS.map(() => 'pending' as StepState), [])
  const initialOpt = useMemo(() => OPTIONAL_COMFY_STEPS.map(() => 'pending' as StepState), [])

  const [coreStates, setCoreStates] = useState<StepState[]>(initialCore)
  const [coreMessages, setCoreMessages] = useState<string[]>(() =>
    CORE_STEPS.map(() => 'Waiting')
  )
  const [coreVersionSubtitles, setCoreVersionSubtitles] = useState<(string | null)[]>(() =>
    CORE_STEPS.map(() => null)
  )
  const [coreChipKinds, setCoreChipKinds] = useState<(CompletionChipKind | null)[]>(() =>
    CORE_STEPS.map(() => null)
  )
  const [optStates, setOptStates] = useState<StepState[]>(initialOpt)
  const [optMessages, setOptMessages] = useState<string[]>(() =>
    OPTIONAL_COMFY_STEPS.map(() => 'Optional — not run yet.')
  )
  const [optVersionSubtitles, setOptVersionSubtitles] = useState<(string | null)[]>(() =>
    OPTIONAL_COMFY_STEPS.map(() => null)
  )
  const [optChipKinds, setOptChipKinds] = useState<(CompletionChipKind | null)[]>(() =>
    OPTIONAL_COMFY_STEPS.map(() => null)
  )
  const [portableComfyPersist, setPortableComfyPersist] = useState<PersistedPortableComfy | null>(
    null
  )
  const [portableInstalling, setPortableInstalling] = useState(false)
  const [comfyPortableVariant, setComfyPortableVariant] = useState<
    'nvidia' | 'nvidia_cu126' | 'amd'
  >('nvidia')
  const [comfyPortableProgress, setComfyPortableProgress] = useState<ScriptProgressEvent | null>(
    null
  )
  const [coreInstallProgress, setCoreInstallProgress] = useState<ScriptProgressEvent | null>(
    null
  )
  const [optionalComfyInstallProgress, setOptionalComfyInstallProgress] =
    useState<ScriptProgressEvent | null>(null)

  const [log, setLog] = useState<string>('')

  const comfyProgressListenTokenRef = useRef<string | null>(null)
  const coreProgressListenTokenRef = useRef<string | null>(null)
  const optionalComfyProgressListenTokenRef = useRef<string | null>(null)

  const wizardPersistRef = useRef<WizardInstallPersisted>(emptyWizardInstallState())
  const runningScriptRef = useRef<{ script: string; since: number; elevated: boolean } | null>(
    null
  )
  const coreProgressGateRef = useRef<ProgressThrottleGate>({ at: 0, sig: '' })
  const comfyProgressGateRef = useRef<ProgressThrottleGate>({ at: 0, sig: '' })
  const optionalProgressGateRef = useRef<ProgressThrottleGate>({ at: 0, sig: '' })
  /** Forces the real installer scripts for ids in this set once (preflight skips disabled). */
  const forceInstallerRef = useRef<Set<string>>(new Set())

  const mergeDetails = (prev: ScriptResult['details']): Record<string, unknown> =>
    typeof prev === 'object' && prev !== null ? { ...(prev as object) } : {}

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const p = await window.privateai.getWizardInstallState()
      if (cancelled) return
      wizardPersistRef.current = p
      const hc = hydrateCoreFromDisk(p.core)
      setCoreStates(hc.states)
      setCoreMessages(hc.messages)
      setCoreVersionSubtitles(hc.subtitles)
      setCoreChipKinds(hc.chips)
      const ho = hydrateOptionalFromDisk(p.optional)
      setOptStates(ho.states)
      setOptMessages(ho.messages)
      setOptVersionSubtitles(ho.subtitles)
      setOptChipKinds(ho.chips)
      setPortableComfyPersist(p.portableComfy ?? null)

      const row = p.core['docker-install']
      const msg = (row?.message ?? '').toLowerCase()
      const staleElevatedJson =
        row?.state === 'error' &&
        (msg.includes('valid json') ||
          msg.includes('invalid_script_output') ||
          msg.includes('elevated script'))
      if (!staleElevatedJson) return

      const pr = await window.privateai.runScript('probe-docker-engine.ps1', undefined, {
        elevated: false,
        timeoutMs: 120_000,
        progressToken: globalThis.crypto.randomUUID()
      })
      if (cancelled) return

      let okResult: ScriptResult | null = pr.ok ? pr : null
      if (!okResult) {
        const ch = await window.privateai.runScript('check-docker.ps1', undefined, {
          elevated: false,
          timeoutMs: 220_000,
          progressToken: globalThis.crypto.randomUUID()
        })
        if (cancelled) return
        if (ch.ok) {
          okResult = {
            ...ch,
            message: `${ch.message} Recovered: Docker is OK; earlier step only failed elevated JSON parsing.`,
            details: { ...mergeDetails(ch.details), wizardProbeSkippedInstall: true },
            warnings: [...ch.warnings]
          }
        }
      } else {
        okResult = {
          ...pr,
          message: `${pr.message} Recovered: stale wizard error cleared (engine reachable).`,
          details: mergeDetails(pr.details),
          warnings: [...pr.warnings]
        }
      }
      if (!okResult || cancelled) return

      const snap = persistedStepFromResult({
        stepId: 'docker-install',
        persistState: 'success',
        message: okResult.message,
        result: okResult
      })
      const next: WizardInstallPersisted = {
        ...wizardPersistRef.current,
        core: { ...wizardPersistRef.current.core, 'docker-install': snap }
      }
      const written = await window.privateai.setWizardInstallState(next)
      if (cancelled) return
      wizardPersistRef.current = written
      const hc2 = hydrateCoreFromDisk(written.core)
      setCoreStates(hc2.states)
      setCoreMessages(hc2.messages)
      setCoreVersionSubtitles(hc2.subtitles)
      setCoreChipKinds(hc2.chips)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const writeWizardPersist = useCallback(async (next: WizardInstallPersisted) => {
    const written = await window.privateai.setWizardInstallState(next)
    wizardPersistRef.current = written
    return written
  }, [])

  useEffect(() => {
    const pass = (gateRef: typeof coreProgressGateRef, p: ScriptProgressEvent, setter: (v: ScriptProgressEvent) => void) => {
      const sig = progressThrottleCoalesce(p)
      const now = Date.now()
      const g = gateRef.current
      if (now - g.at < 420 && sig === g.sig) return
      gateRef.current = { at: now, sig }
      setter(p)
    }
    return window.privateai.onScriptProgress((p) => {
      if (p.token === comfyProgressListenTokenRef.current) {
        pass(comfyProgressGateRef, p, setComfyPortableProgress)
        return
      }
      if (p.token === coreProgressListenTokenRef.current) {
        pass(coreProgressGateRef, p, setCoreInstallProgress)
        return
      }
      if (p.token === optionalComfyProgressListenTokenRef.current) {
        pass(optionalProgressGateRef, p, setOptionalComfyInstallProgress)
      }
    })
  }, [])

  const appendLog = useCallback((line: string) => {
    setLog((prev) => (prev ? `${prev}\n${line}` : line))
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      const cur = runningScriptRef.current
      if (!cur) return
      const sec = Math.floor((Date.now() - cur.since) / 1000)
      if (sec < 10) return
      const uac = cur.elevated ? ' Approve UAC if Windows shows it. ' : ' '
      const tail = cur.script.includes('install-comfyui-portable')
        ? ' Downloading/extracting the portable build can take many minutes (large archive).'
        : ' Long docker/WSL steps can take many minutes.'
      setLog((prev) => `${prev || ''}\n... ${cur.script} still running (${sec}s).${uac}${tail}`)
    }, 12_000)
    return () => window.clearInterval(id)
  }, [])

  const comfyOptRunning = useMemo(() => optStates.some((s) => s === 'running'), [optStates])
  const comfySectionBusy = comfyOptRunning || portableInstalling

  const coreRunningIdx = coreStates.findIndex((s) => s === 'running')
  const coreFlowBusy = useMemo(() => coreStates.some((s) => s === 'running'), [coreStates])
  const optRunningIdx = optStates.findIndex((s) => s === 'running')

  const applyStepResult = useCallback(
    (
      step: WizardStep,
      r: ScriptResult,
      opts?: { skipInstallerStdoutLog?: boolean }
    ): { message: string; state: StepState; wizardOllamaMissingOnly: boolean } => {
      if (!opts?.skipInstallerStdoutLog) {
        appendLog(
          `${step.script} => ok=${r.ok} status=${r.status}${step.elevated ? ' [elevated]' : ''}`
        )
      }
      if (r.details && Object.keys(r.details).length > 0) {
        if (
          !r.ok ||
          (r.warnings.length > 0 &&
            (step.id === 'docker-install' || step.id === 'system'))
        ) {
          appendLog(`details: ${JSON.stringify(r.details).slice(0, 4000)}`)
        }
      }
      if (!r.ok && r.errors.length > 0) {
        appendLog(`errors: ${JSON.stringify(r.errors).slice(0, 4000)}`)
      }
      const wizardOllamaMissingOnly =
        step.id === 'ollama-check' &&
        !r.ok &&
        r.errors.length > 0 &&
        r.errors.every((e) => e.code === 'OLLAMA_NOT_FOUND')

      let nextState: StepState = r.ok ? (r.warnings.length ? 'warning' : 'success') : 'error'
      let message = r.message
      if (wizardOllamaMissingOnly) {
        nextState = 'success'
        message =
          'Ollama is not installed yet (expected on a fresh machine). The next step installs it automatically.'
      }
      return { message, state: nextState, wizardOllamaMissingOnly }
    },
    [appendLog]
  )

  const tryInstallPreflightProbe = async (
    step: WizardStep,
    progressToken: string
  ): Promise<ScriptResult | null> => {
    if (!(INSTALL_PREFLIGHT_IDS as readonly string[]).includes(step.id)) return null

    const tokenOpts = {
      elevated: false as boolean,
      timeoutMs: step.id === 'docker-install' ? 240_000 : 140_000,
      progressToken
    }

    if (step.id === 'ollama') {
      appendLog(`--- preflight: check-ollama.ps1 (installer may be skipped when API is up)`)
      const pr = await window.privateai.runScript('check-ollama.ps1', undefined, tokenOpts)
      if (!pr.ok) return null
      return {
        ...pr,
        message: `${pr.message} Install script skipped (probe).`,
        details: { ...mergeDetails(pr.details), wizardProbeSkippedInstall: true },
        warnings: [...pr.warnings]
      }
    }

    if (step.id === 'docker-install') {
      appendLog(`--- preflight: probe-docker-engine.ps1 (avoids elevated install-docker.ps1 when possible)`)
      const pr = await window.privateai.runScript('probe-docker-engine.ps1', undefined, tokenOpts)
      if (pr.ok) {
        return {
          ...pr,
          details: mergeDetails(pr.details),
          warnings: [...pr.warnings]
        }
      }
      appendLog(
        `--- preflight: engine probe inconclusive; check-docker.ps1 (non-admin, longer wait) ---`
      )
      const ch = await window.privateai.runScript('check-docker.ps1', undefined, tokenOpts)
      if (!ch.ok) return null
      return {
        ...ch,
        message: `${ch.message} Install script skipped (check-docker probe).`,
        details: { ...mergeDetails(ch.details), wizardProbeSkippedInstall: true },
        warnings: [...ch.warnings]
      }
    }

    appendLog(`--- preflight: probe-openwebui.ps1 (skips installer when container already runs)`)
    const pr = await window.privateai.runScript('probe-openwebui.ps1', undefined, tokenOpts)
    if (!pr.ok) return null
    return {
      ...pr,
      details: mergeDetails(pr.details),
      warnings: [...pr.warnings]
    }
  }

  const runCoreStepAt = async (i: number): Promise<boolean> => {
    const step = CORE_STEPS[i]!
    setCoreInstallProgress(null)
    if (!coreProgressListenTokenRef.current) {
      coreProgressListenTokenRef.current = globalThis.crypto.randomUUID()
    }
    setCoreStates((s) => s.map((v, idx) => (idx === i ? 'running' : v)))
    setCoreMessages((m) => m.map((v, idx) => (idx === i ? runningLine(step) : v)))

    try {
      if (!step.script) {
        setCoreStates((s) => s.map((v, idx) => (idx === i ? 'success' : v)))
        setCoreMessages((m) => m.map((v, idx) => (idx === i ? 'No script for this step yet.' : v)))
        const snapSelf = persistedStepFromResult({
          stepId: step.id,
          persistState: 'success',
          message: 'No script for this step yet.',
          result: {
            ok: true,
            status: 'success',
            message: '-',
            details: {},
            warnings: [],
            errors: []
          }
        })
        const nextSnap: WizardInstallPersisted = {
          ...wizardPersistRef.current,
          core: { ...wizardPersistRef.current.core, [step.id]: snapSelf }
        }
        await writeWizardPersist(nextSnap)
        setCoreVersionSubtitles((sub) =>
          sub.map((v, j) => (j === i ? snapSelf.version ?? null : v))
        )
        setCoreChipKinds((c) => c.map((v, j) => (j === i ? snapSelf.completionChip ?? null : v)))
        return true
      }

      runningScriptRef.current = {
        script: step.script,
        since: Date.now(),
        elevated: step.elevated === true
      }

      let r: ScriptResult
      let usedSkipInstallerLog = false

      const progressTokenLocal = coreProgressListenTokenRef.current!

      const mustRunInstaller = forceInstallerRef.current.has(step.id)
      if (mustRunInstaller) {
        forceInstallerRef.current.delete(step.id)
      }

      const allowPreflightProbe =
        !mustRunInstaller && (INSTALL_PREFLIGHT_IDS as readonly string[]).includes(step.id)
      if (allowPreflightProbe) {
        const pref = await tryInstallPreflightProbe(step, progressTokenLocal)
        if (pref != null && pref.ok) {
          appendLog(`--- ${step.script} bypassed (${step.id}); dependency already satisfies this step`)
          r = pref
          usedSkipInstallerLog = true
        } else {
          appendLog(`--- ${step.script} started${step.elevated ? ' [elevated - approve UAC if Windows shows it]' : ''} ---`)
          const scriptArgs =
            step.id === 'models' ? { Model: WIZARD_STARTER_OLLAMA_MODEL } : undefined
          r = await window.privateai.runScript(step.script, scriptArgs, {
            elevated: step.elevated,
            timeoutMs: step.timeoutMs,
            progressToken: progressTokenLocal
          })
          usedSkipInstallerLog = false
        }
      } else {
        if (mustRunInstaller && (INSTALL_PREFLIGHT_IDS as readonly string[]).includes(step.id)) {
          appendLog(`--- ${step.script} full run (${step.id} — preflight skipped) ---`)
        } else {
          appendLog(`--- ${step.script} started${step.elevated ? ' [elevated - approve UAC if Windows shows it]' : ''} ---`)
        }
        const scriptArgs = step.id === 'models' ? { Model: WIZARD_STARTER_OLLAMA_MODEL } : undefined
        r = await window.privateai.runScript(step.script, scriptArgs, {
          elevated: step.elevated,
          timeoutMs: step.timeoutMs,
          progressToken: progressTokenLocal
        })
      }

      runningScriptRef.current = null
      const { message, state, wizardOllamaMissingOnly } = applyStepResult(step, r, {
        skipInstallerStdoutLog: usedSkipInstallerLog
      })
      setCoreMessages((m) => m.map((v, idx) => (idx === i ? message : v)))
      setCoreStates((s) => s.map((v, idx) => (idx === i ? state : v)))
      const persistOutcome = stepStateToPersistedOutcome(state)
      if (persistOutcome !== null) {
        const snap = persistedStepFromResult({
          stepId: step.id,
          persistState: persistOutcome,
          message,
          result: r,
          wizardOllamaMissingOnly
        })
        const nextPersist: WizardInstallPersisted = {
          ...wizardPersistRef.current,
          core: { ...wizardPersistRef.current.core, [step.id]: snap }
        }
        await writeWizardPersist(nextPersist)
        setCoreVersionSubtitles((sub) =>
          sub.map((v, j) => (j === i ? snap.version ?? null : v))
        )
        setCoreChipKinds((c) => c.map((v, j) => (j === i ? snap.completionChip ?? null : v)))
      }
      const rebootPause =
        step.id === 'docker-install' &&
        r.ok &&
        typeof r.details === 'object' &&
        r.details !== null &&
        (r.details as Record<string, unknown>).rebootRequired === true
      const precheckAllowsNextInstaller =
        !r.ok &&
        step.id === 'ollama-check' &&
        r.errors.some((err) => err.code === 'OLLAMA_NOT_FOUND')
      if ((!r.ok && !precheckAllowsNextInstaller) || rebootPause) return false
      return true
    } catch (e) {
      runningScriptRef.current = null
      appendLog(`${step.script ?? 'step'} threw: ${String(e)}`)
      setCoreStates((s) => s.map((v, idx) => (idx === i ? 'error' : v)))
      setCoreMessages((m) => m.map((v, idx) => (idx === i ? String(e) : v)))
      const errSnap = {
        state: 'error' as const,
        message: String(e),
        version: null as string | null,
        completionChip: null as CompletionChipKind | null,
        recordedAt: new Date().toISOString()
      }
      const next: WizardInstallPersisted = {
        ...wizardPersistRef.current,
        core: { ...wizardPersistRef.current.core, [step.id]: errSnap }
      }
      await writeWizardPersist(next)
      setCoreVersionSubtitles((sub) => sub.map((v, j) => (j === i ? null : v)))
      setCoreChipKinds((c) => c.map((v, j) => (j === i ? null : v)))
      return false
    }
  }

  /** Runs step `startIdx` and every step after it. Resets persisted state only for those rows. */
  const runCoreFromStepDownward = async (startIdx: number) => {
    if (startIdx < 0 || startIdx >= CORE_STEPS.length) return
    const firstId = CORE_STEPS[startIdx]!.id
    forceInstallerRef.current.add(firstId)

    appendLog('')
    appendLog(
      `--- Continue core from step ${startIdx + 1} (“${CORE_STEPS[startIdx]!.title}”) through the last step ---`
    )
    runningScriptRef.current = null

    const prunedCore: WizardInstallPersisted['core'] = { ...wizardPersistRef.current.core }
    for (let j = startIdx; j < CORE_STEPS.length; j++) {
      delete prunedCore[CORE_STEPS[j]!.id]
    }
    await writeWizardPersist({ ...wizardPersistRef.current, core: prunedCore })

    setCoreStates((states) =>
      states.map((s, idx) => (idx < startIdx ? s : 'pending'))
    )
    setCoreMessages((m) =>
      m.map((v, idx) => (idx < startIdx ? v : 'Waiting'))
    )
    setCoreVersionSubtitles((sub) => sub.map((v, idx) => (idx < startIdx ? v : null)))
    setCoreChipKinds((cks) => cks.map((v, idx) => (idx < startIdx ? v : null)))

    coreProgressGateRef.current = { at: 0, sig: '' }
    const progressToken = globalThis.crypto.randomUUID()
    coreProgressListenTokenRef.current = progressToken
    setCoreInstallProgress(null)

    try {
      for (let i = startIdx; i < CORE_STEPS.length; i++) {
        const advance = await runCoreStepAt(i)
        if (!advance) break
      }
    } finally {
      coreProgressListenTokenRef.current = null
      setCoreInstallProgress(null)
    }
  }

  const runCore = async () => {
    setLog('')
    runningScriptRef.current = null
    setCoreStates(CORE_STEPS.map(() => 'pending'))
    setCoreMessages(CORE_STEPS.map(() => 'Waiting'))
    setCoreVersionSubtitles(CORE_STEPS.map(() => null))
    setCoreChipKinds(CORE_STEPS.map(() => null))
    const cleared: WizardInstallPersisted = { ...wizardPersistRef.current, core: {} }
    await writeWizardPersist(cleared)

    const progressToken = globalThis.crypto.randomUUID()
    coreProgressListenTokenRef.current = progressToken
    coreProgressGateRef.current = { at: 0, sig: '' }
    setCoreInstallProgress(null)

    try {
      for (let i = 0; i < CORE_STEPS.length; i++) {
        const advance = await runCoreStepAt(i)
        if (!advance) break
      }
    } finally {
      coreProgressListenTokenRef.current = null
      setCoreInstallProgress(null)
    }
  }

  const runOptionalComfy = async () => {
    if (portableInstalling) {
      appendLog('Optional Comfy setup is waiting — finish portable download/extract first.')
      return
    }
    appendLog('')
    appendLog('--- Optional: ComfyUI (launcher scripts) ---')
    runningScriptRef.current = null
    setOptStates(OPTIONAL_COMFY_STEPS.map(() => 'pending'))
    setOptMessages(OPTIONAL_COMFY_STEPS.map(() => 'Waiting'))
    setOptVersionSubtitles(OPTIONAL_COMFY_STEPS.map(() => null))
    setOptChipKinds(OPTIONAL_COMFY_STEPS.map(() => null))
    const clearedOpt: WizardInstallPersisted = { ...wizardPersistRef.current, optional: {} }
    await writeWizardPersist(clearedOpt)

    const progressToken = globalThis.crypto.randomUUID()
    optionalComfyProgressListenTokenRef.current = progressToken
    optionalProgressGateRef.current = { at: 0, sig: '' }
    setOptionalComfyInstallProgress(null)

    try {
      for (let i = 0; i < OPTIONAL_COMFY_STEPS.length; i++) {
        const step = OPTIONAL_COMFY_STEPS[i]!
        setOptionalComfyInstallProgress(null)
        setOptStates((s) => s.map((v, idx) => (idx === i ? 'running' : v)))
        setOptMessages((m) => m.map((v, idx) => (idx === i ? runningLine(step) : v)))
        try {
          if (!step.script) {
            setOptStates((s) => s.map((v, idx) => (idx === i ? 'success' : v)))
            setOptMessages((m) =>
              m.map((v, idx) => (idx === i ? 'No script for this step yet.' : v))
            )
            continue
          }
          runningScriptRef.current = {
            script: step.script,
            since: Date.now(),
            elevated: step.elevated === true
          }
          appendLog(`--- ${step.script} started (ComfyUI extras) ---`)
          const r: ScriptResult = await window.privateai.runScript(step.script, undefined, {
            elevated: step.elevated,
            timeoutMs: step.timeoutMs,
            progressToken
          })
          runningScriptRef.current = null
          const { message, state, wizardOllamaMissingOnly } = applyStepResult(step, r)
          setOptMessages((m) => m.map((v, idx) => (idx === i ? message : v)))
          setOptStates((s) => s.map((v, idx) => (idx === i ? state : v)))
          const persistOutcome = stepStateToPersistedOutcome(state)
          if (persistOutcome !== null) {
            const snap = persistedStepFromResult({
              stepId: step.id,
              persistState: persistOutcome,
              message,
              result: r,
              wizardOllamaMissingOnly
            })
            const next: WizardInstallPersisted = {
              ...wizardPersistRef.current,
              optional: { ...wizardPersistRef.current.optional, [step.id]: snap }
            }
            await writeWizardPersist(next)
            setOptVersionSubtitles((sub) =>
              sub.map((v, j) => (j === i ? snap.version ?? null : v))
            )
            setOptChipKinds((cks) =>
              cks.map((v, j) => (j === i ? snap.completionChip ?? null : v))
            )
          }
          if (!r.ok) break
        } catch (e) {
          const optStep = OPTIONAL_COMFY_STEPS[i]!
          runningScriptRef.current = null
          appendLog(`${optStep.script} threw: ${String(e)}`)
          setOptStates((s) => s.map((v, idx) => (idx === i ? 'error' : v)))
          setOptMessages((m) => m.map((v, idx) => (idx === i ? String(e) : v)))
          const errSnap = {
            state: 'error' as const,
            message: String(e),
            version: null as string | null,
            completionChip: null as CompletionChipKind | null,
            recordedAt: new Date().toISOString()
          }
          const next: WizardInstallPersisted = {
            ...wizardPersistRef.current,
            optional: { ...wizardPersistRef.current.optional, [optStep.id]: errSnap }
          }
          await writeWizardPersist(next)
          setOptVersionSubtitles((sub) => sub.map((v, j) => (j === i ? null : v)))
          setOptChipKinds((cks) => cks.map((v, j) => (j === i ? null : v)))
          break
        }
      }
    } finally {
      optionalComfyProgressListenTokenRef.current = null
      setOptionalComfyInstallProgress(null)
    }
  }

  const downloadPortableComfy = async () => {
    if (comfyOptRunning) {
      appendLog('Portable download waits until launcher setup finishes its current script.')
      return
    }
    if (portableInstalling) return
    const progressToken = globalThis.crypto.randomUUID()
    comfyProgressListenTokenRef.current = progressToken
    comfyProgressGateRef.current = { at: 0, sig: '' }
    setComfyPortableProgress(null)
    setPortableInstalling(true)
    runningScriptRef.current = {
      script: 'install-comfyui-portable.ps1',
      since: Date.now(),
      elevated: false
    }
    appendLog(`--- install-comfyui-portable.ps1 started (variant=${comfyPortableVariant}) ---`)
    try {
      const r: ScriptResult = await window.privateai.runScript(
        'install-comfyui-portable.ps1',
        { Variant: comfyPortableVariant },
        { timeoutMs: 7_200_000, progressToken }
      )
      appendLog(`install-comfyui-portable.ps1 => ok=${r.ok} status=${r.status}`)
      if (r.details && Object.keys(r.details).length > 0) {
        if (!r.ok) {
          appendLog(`details: ${JSON.stringify(r.details).slice(0, 4000)}`)
        }
      }
      if (!r.ok && r.errors.length > 0) {
        appendLog(`errors: ${JSON.stringify(r.errors).slice(0, 4000)}`)
      }
      appendLog(r.message)
      const outcome: PersistableWizardOutcome =
        r.status === 'warning' ? 'warning' : r.status === 'error' || !r.ok ? 'error' : 'success'
      const d =
        r.details && typeof r.details === 'object'
          ? (r.details as Record<string, unknown>)
          : undefined
      const urlHint =
        d && typeof d.comfyUrl === 'string' && d.comfyUrl.trim().length > 0
          ? d.comfyUrl.trim()
          : null
      const pu: PersistedPortableComfy = {
        state: outcome,
        message: r.message,
        version: urlHint,
        variant: comfyPortableVariant,
        recordedAt: new Date().toISOString()
      }
      const next: WizardInstallPersisted = { ...wizardPersistRef.current, portableComfy: pu }
      await writeWizardPersist(next)
      setPortableComfyPersist(pu)
    } catch (e) {
      appendLog(`install-comfyui-portable.ps1 threw: ${String(e)}`)
      const pu: PersistedPortableComfy = {
        state: 'error',
        message: String(e),
        version: null,
        variant: comfyPortableVariant,
        recordedAt: new Date().toISOString()
      }
      const next: WizardInstallPersisted = { ...wizardPersistRef.current, portableComfy: pu }
      await writeWizardPersist(next)
      setPortableComfyPersist(pu)
    } finally {
      comfyProgressListenTokenRef.current = null
      setComfyPortableProgress(null)
      runningScriptRef.current = null
      setPortableInstalling(false)
    }
  }

  const openComfyGettingStartedDocs = () => {
    void window.privateai.openExternal('https://docs.comfy.org/get_started/pre_package')
  }

  const comfyPortableProg = portableInstalling
    ? comfyPortableProgressLine(comfyPortableProgress)
    : null

  return (
    <div>
      <h1 className="page-title">Install</h1>
      <p className="page-sub">
        Prefer <Link to="/check-my-pc">Check my PC</Link> first for a go / caution verdict on GPU, RAM, disk, and
        ports. Core setup probes what is already installed (Ollama, Docker engine, Open WebUI) so installers and
        UAC run only when needed. Chips show <strong>Installed</strong> vs <strong>Verified</strong> for clarity.{' '}
        <strong>Run from here</strong> continues from that row through the rest of core setup (installer for
        that row forces once; probes still apply afterward). Installer scripts can spike CPU/Disk—that is
        expected; progress updates are intentionally throttled to keep the launcher light. Finished steps are
        saved on this machine.
      </p>

      <div className="row-actions" style={{ marginBottom: 16 }}>
        <ActionButton variant="primary" onClick={() => void runCore()}>
          Run core install
        </ActionButton>
      </div>

      <div className="stack">
        {CORE_STEPS.map((s, idx) => {
          const coreProg =
            idx === coreRunningIdx && (coreStates[idx] ?? 'pending') === 'running'
              ? wizardStepScriptProgress(coreInstallProgress)
              : null
          return (
            <StepCard
              key={s.id}
              index={idx + 1}
              title={s.title}
              completionChip={coreChipKinds[idx] ?? undefined}
              versionSubtitle={coreVersionSubtitles[idx]}
              message={coreMessages[idx] ?? ''}
              state={coreStates[idx] ?? 'pending'}
              runningStatusLabel={RUNNING_STATUS_LABEL[s.id]}
              showIndeterminateProgress={coreProg === null}
              scriptProgress={coreProg}
            >
              {coreFlowBusy ? null : (
                <div style={{ marginTop: 10 }}>
                  <div className="row-actions">
                    <ActionButton
                      variant="ghost"
                      onClick={() => void runCoreFromStepDownward(idx)}
                      style={{ fontSize: 12 }}
                    >
                      Run from here
                    </ActionButton>
                  </div>
                  <span className="muted" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
                    Runs this row and every step below (earlier rows stay as they are).
                  </span>
                </div>
              )}
            </StepCard>
          )
        })}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Log</h3>
        <LogPanel text={log} />
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>Extra: ComfyUI (optional)</h3>
        <p className="page-sub" style={{ marginBottom: 12 }}>
          The core wizard does not require Comfy. <strong>Download portable</strong> gets the official Windows
          package for you (with a visible progress bar), unpacks it, turns on network listening,{' '}
          <strong>starts Comfy minimized</strong> so you never need to run a terminal, then you can tap{' '}
          <strong>Launcher setup</strong> to confirm the port and pick up templates under{' '}
          <code>workflows/comfyui</code>. Default URL is port <code>8188</code> unless{' '}
          <code>config/ports.json</code> says otherwise.
        </p>
        {portableComfyPersist && !portableInstalling ? (
          <p className="muted" style={{ fontSize: 12, marginBottom: 12 }} title={portableComfyPersist.message}>
            <strong>Portable Comfy</strong>
            {portableComfyPersist.variant ? ` (${portableComfyPersist.variant})` : ''}
            {portableComfyPersist.version ? ` — ${portableComfyPersist.version}` : ''}
            {' — '}
            {portableComfyPersist.message.length > 140
              ? `${portableComfyPersist.message.slice(0, 139)}…`
              : portableComfyPersist.message}
          </p>
        ) : null}
        {comfyPortableProg ? (
          <div style={{ marginBottom: 14 }} role="status" aria-live="polite">
            <div style={{ marginBottom: 8, fontSize: 13, color: 'var(--muted)' }}>
              {comfyPortableProg.caption}
            </div>
            <div className="progress-track" aria-label="Comfy portable install progress">
              {comfyPortableProg.indeterminate || comfyPortableProg.barPct === null ? (
                <div className="progress-fill--indeterminate" />
              ) : (
                <div
                  className="progress-fill--determinate"
                  style={{ width: `${Math.min(100, comfyPortableProg.barPct)}%` }}
                />
              )}
            </div>
          </div>
        ) : null}
        <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="muted" style={{ fontSize: 13 }}>
            Portable variant
            <select
              aria-label="Comfy portable build variant"
              value={comfyPortableVariant}
              disabled={comfySectionBusy}
              onChange={(e) =>
                setComfyPortableVariant(e.target.value as 'nvidia' | 'nvidia_cu126' | 'amd')
              }
              style={{ marginLeft: 8 }}
            >
              <option value="nvidia">NVIDIA</option>
              <option value="nvidia_cu126">NVIDIA (CUDA 12.6)</option>
              <option value="amd">AMD</option>
            </select>
          </label>
        </div>
        <div className="row-actions" style={{ marginBottom: 16 }}>
          <ActionButton variant="ghost" onClick={() => void openComfyGettingStartedDocs()}>
            Docs: pre-packaged install
          </ActionButton>
          <ActionButton
            variant="primary"
            disabled={comfySectionBusy}
            onClick={() => void downloadPortableComfy()}
          >
            Download portable
          </ActionButton>
          <ActionButton disabled={comfySectionBusy} onClick={() => void runOptionalComfy()}>
            Run launcher setup
          </ActionButton>
        </div>

        <p className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
          Optional steps (only run when you tap the button above)
        </p>
        <div className="stack">
          {OPTIONAL_COMFY_STEPS.map((s, idx) => {
            const optProg =
              !portableInstalling &&
              idx === optRunningIdx &&
              (optStates[idx] ?? 'pending') === 'running'
                ? wizardStepScriptProgress(optionalComfyInstallProgress)
                : null
            return (
              <StepCard
                key={s.id}
                index={idx + 1}
                title={s.title}
                completionChip={optChipKinds[idx] ?? undefined}
                versionSubtitle={optVersionSubtitles[idx]}
                message={optMessages[idx] ?? ''}
                state={optStates[idx] ?? 'pending'}
                runningStatusLabel={RUNNING_STATUS_LABEL[s.id]}
                showIndeterminateProgress={optProg === null}
                scriptProgress={optProg}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
