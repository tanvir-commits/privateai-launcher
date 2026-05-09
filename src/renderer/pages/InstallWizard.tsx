import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import modelProfiles from '@config/model-profiles.json'
import { ActionButton } from '../components/ActionButton'
import { LogPanel } from '../components/LogPanel'
import { StepCard, type StepState } from '../components/StepCard'
import type { ScriptProgressEvent } from '@shared/scriptProgress'
import type { ScriptResult } from '@shared/scriptContract'

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
  { id: 'ollama', title: 'Install / verify Ollama', script: 'install-ollama.ps1' },
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
    elevated: true,
    timeoutMs: 180_000
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
  ollama: 'Installing or verifying Ollama…',
  'docker-install':
    'Installing or verifying Docker Desktop (admin). If the engine already runs, this step finishes quickly; otherwise DISM/WSL/winget/ACL work can take 5–15+ minutes. Approve UAC. If Docker Desktop opens, finish any update or onboarding there first. Log lines every ~12s.',
  docker: 'Checking Docker engine…',
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

export default function InstallWizard() {
  const initialCore = useMemo(() => CORE_STEPS.map(() => 'pending' as StepState), [])
  const initialOpt = useMemo(() => OPTIONAL_COMFY_STEPS.map(() => 'pending' as StepState), [])

  const [coreStates, setCoreStates] = useState<StepState[]>(initialCore)
  const [coreMessages, setCoreMessages] = useState<string[]>(() =>
    CORE_STEPS.map(() => 'Waiting')
  )
  const [optStates, setOptStates] = useState<StepState[]>(initialOpt)
  const [optMessages, setOptMessages] = useState<string[]>(() =>
    OPTIONAL_COMFY_STEPS.map(() => 'Optional — not run yet.')
  )
  const [portableInstalling, setPortableInstalling] = useState(false)
  const [comfyPortableVariant, setComfyPortableVariant] = useState<
    'nvidia' | 'nvidia_cu126' | 'amd'
  >('nvidia')
  const [comfyPortableProgress, setComfyPortableProgress] = useState<ScriptProgressEvent | null>(
    null
  )

  const [log, setLog] = useState<string>('')

  const comfyProgressListenTokenRef = useRef<string | null>(null)

  const runningScriptRef = useRef<{ script: string; since: number; elevated: boolean } | null>(
    null
  )

  useEffect(() => {
    return window.privateai.onScriptProgress((p) => {
      if (p.token !== comfyProgressListenTokenRef.current) return
      setComfyPortableProgress(p)
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

  const applyStepResult = useCallback(
    (step: WizardStep, r: ScriptResult): { message: string; state: StepState } => {
      appendLog(
        `${step.script} => ok=${r.ok} status=${r.status}${step.elevated ? ' [elevated]' : ''}`
      )
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
      const nextState: StepState = r.ok ? (r.warnings.length ? 'warning' : 'success') : 'error'
      return { message: r.message, state: nextState }
    },
    [appendLog]
  )

  const runCore = async () => {
    setLog('')
    runningScriptRef.current = null
    setCoreStates(CORE_STEPS.map(() => 'pending'))
    setCoreMessages(CORE_STEPS.map(() => 'Waiting'))

    for (let i = 0; i < CORE_STEPS.length; i++) {
      const step = CORE_STEPS[i]!
      setCoreStates((s) => s.map((v, idx) => (idx === i ? 'running' : v)))
      setCoreMessages((m) => m.map((v, idx) => (idx === i ? runningLine(step) : v)))
      try {
        if (!step.script) {
          setCoreStates((s) => s.map((v, idx) => (idx === i ? 'success' : v)))
          setCoreMessages((m) => m.map((v, idx) => (idx === i ? 'No script for this step yet.' : v)))
          continue
        }
        runningScriptRef.current = {
          script: step.script,
          since: Date.now(),
          elevated: step.elevated === true
        }
        appendLog(
          `--- ${step.script} started${step.elevated ? ' [elevated - approve UAC if Windows shows it]' : ''} ---`
        )
        const scriptArgs =
          step.id === 'models' ? { Model: WIZARD_STARTER_OLLAMA_MODEL } : undefined
        const r: ScriptResult = await window.privateai.runScript(step.script, scriptArgs, {
          elevated: step.elevated,
          timeoutMs: step.timeoutMs
        })
        runningScriptRef.current = null
        const { message, state } = applyStepResult(step, r)
        setCoreMessages((m) => m.map((v, idx) => (idx === i ? message : v)))
        setCoreStates((s) => s.map((v, idx) => (idx === i ? state : v)))
        const rebootPause =
          step.id === 'docker-install' &&
          r.ok &&
          typeof r.details === 'object' &&
          r.details !== null &&
          (r.details as Record<string, unknown>).rebootRequired === true
        if (!r.ok || rebootPause) break
      } catch (e) {
        runningScriptRef.current = null
        appendLog(`${step.script} threw: ${String(e)}`)
        setCoreStates((s) => s.map((v, idx) => (idx === i ? 'error' : v)))
        setCoreMessages((m) => m.map((v, idx) => (idx === i ? String(e) : v)))
        break
      }
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

    for (let i = 0; i < OPTIONAL_COMFY_STEPS.length; i++) {
      const step = OPTIONAL_COMFY_STEPS[i]!
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
          timeoutMs: step.timeoutMs
        })
        runningScriptRef.current = null
        const { message, state } = applyStepResult(step, r)
        setOptMessages((m) => m.map((v, idx) => (idx === i ? message : v)))
        setOptStates((s) => s.map((v, idx) => (idx === i ? state : v)))
        if (!r.ok) break
      } catch (e) {
        runningScriptRef.current = null
        appendLog(`${step.script} threw: ${String(e)}`)
        setOptStates((s) => s.map((v, idx) => (idx === i ? 'error' : v)))
        setOptMessages((m) => m.map((v, idx) => (idx === i ? String(e) : v)))
        break
      }
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
    } catch (e) {
      appendLog(`install-comfyui-portable.ps1 threw: ${String(e)}`)
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
      <h1 className="page-title">Install Wizard</h1>
      <p className="page-sub">
        Start with core setup for local chat (<strong>Ollama</strong> + <strong>Open WebUI</strong>).
        ComfyUI sits at the bottom: use the portable downloader if you want it, then the launcher verifies
        the port and records bundled workflow templates.
      </p>

      <div className="row-actions" style={{ marginBottom: 16 }}>
        <ActionButton variant="primary" onClick={() => void runCore()}>
          Run core install
        </ActionButton>
      </div>

      <div className="stack">
        {CORE_STEPS.map((s, idx) => (
          <StepCard
            key={s.id}
            index={idx + 1}
            title={s.title}
            message={coreMessages[idx] ?? ''}
            state={coreStates[idx] ?? 'pending'}
            runningStatusLabel={RUNNING_STATUS_LABEL[s.id]}
            showIndeterminateProgress
          />
        ))}
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
          {OPTIONAL_COMFY_STEPS.map((s, idx) => (
            <StepCard
              key={s.id}
              index={idx + 1}
              title={s.title}
              message={optMessages[idx] ?? ''}
              state={optStates[idx] ?? 'pending'}
              runningStatusLabel={RUNNING_STATUS_LABEL[s.id]}
              showIndeterminateProgress
            />
          ))}
        </div>
      </div>
    </div>
  )
}
