import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActionButton } from '../components/ActionButton'
import { LogPanel } from '../components/LogPanel'
import { StepCard, type StepState } from '../components/StepCard'
import type { ScriptResult } from '@shared/scriptContract'

type WizardStep = {
  id: string
  title: string
  script?: string
  elevated?: boolean
  timeoutMs?: number
}

const STEPS: WizardStep[] = [
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
  { id: 'docker', title: 'Check Docker Desktop', script: 'check-docker.ps1' },
  { id: 'openwebui', title: 'Install / verify Open WebUI', script: 'install-openwebui.ps1' },
  { id: 'comfy', title: 'Install / verify ComfyUI', script: 'install-comfyui.ps1' },
  { id: 'models', title: 'Download starter models', script: 'download-models.ps1' },
  { id: 'cfg-ow', title: 'Configure Open WebUI', script: 'configure-openwebui.ps1' },
  { id: 'cfg-comfy', title: 'Configure ComfyUI integration', script: 'configure-comfyui.ps1' },
  { id: 'health', title: 'Run health check', script: 'health-check.ps1' }
]

/** Status chip text while a step is running (installer UX). */
const RUNNING_STATUS_LABEL: Partial<Record<string, string>> = {
  ollama: 'Installing',
  'docker-install': 'Installing',
  docker: 'Checking',
  openwebui: 'Installing',
  comfy: 'Installing',
  models: 'Downloading',
  'cfg-ow': 'Configuring',
  'cfg-comfy': 'Configuring',
  health: 'Checking'
}

/** Secondary line while scripts run (replaces generic "Running script…"). */
const RUNNING_MESSAGE: Partial<Record<string, string>> = {
  system: 'Scanning system…',
  gpu: 'Checking GPU and drivers…',
  'ollama-check': 'Checking Ollama…',
  ollama: 'Installing or verifying Ollama…',
  'docker-install':
    'Installing or verifying Docker Desktop (admin). Enables WSL + Virtual Machine Platform via DISM, fixes ProgramData ownership if needed, then winget. One Windows restart may be required (the wizard will say so). Approve UAC. Can take 5-15+ minutes; the Log adds a line every ~12s.',
  docker: 'Checking Docker engine…',
  openwebui: 'Installing or verifying Open WebUI…',
  comfy: 'Installing or verifying ComfyUI…',
  models: 'Downloading models (sizes vary; can take a long time)…',
  'cfg-ow': 'Applying Open WebUI configuration…',
  'cfg-comfy': 'Applying ComfyUI configuration…',
  health: 'Running health checks…'
}

function runningLine(step: WizardStep): string {
  if (step.id in RUNNING_MESSAGE) {
    return RUNNING_MESSAGE[step.id]!
  }
  return 'Running script…'
}

export default function InstallWizard() {
  const initial = useMemo(() => STEPS.map(() => 'pending' as StepState), [])
  const [states, setStates] = useState<StepState[]>(initial)
  const [messages, setMessages] = useState<string[]>(() => STEPS.map(() => 'Waiting'))
  const [log, setLog] = useState<string>('')

  /** While a script is awaited, log periodic heartbeats so long steps do not look hung. */
  const runningScriptRef = useRef<{ script: string; since: number } | null>(null)

  const appendLog = useCallback((line: string) => {
    setLog((prev) => (prev ? `${prev}\n${line}` : line))
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      const cur = runningScriptRef.current
      if (!cur) return
      const sec = Math.floor((Date.now() - cur.since) / 1000)
      if (sec < 10) return
      setLog(
        (prev) =>
          `${prev || ''}\n... ${cur.script} still running (${sec}s). Elevated Docker: approve UAC, then wait for winget and file copy (often several minutes).`
      )
    }, 12_000)
    return () => window.clearInterval(id)
  }, [])

  const runAll = async () => {
    setLog('')
    runningScriptRef.current = null
    for (let i = 0; i < STEPS.length; i++) {
      const step = STEPS[i]!
      setStates((s) => s.map((v, idx) => (idx === i ? 'running' : v)))
      setMessages((m) => m.map((v, idx) => (idx === i ? runningLine(step) : v)))
      try {
        if (!step.script) {
          setStates((s) => s.map((v, idx) => (idx === i ? 'success' : v)))
          setMessages((m) => m.map((v, idx) => (idx === i ? 'No script for this step yet.' : v)))
          continue
        }
        runningScriptRef.current = { script: step.script, since: Date.now() }
        appendLog(
          `--- ${step.script} started${step.elevated ? ' [elevated - approve UAC if Windows shows it]' : ''} ---`
        )
        const r: ScriptResult = await window.privateai.runScript(step.script, undefined, {
          elevated: step.elevated,
          timeoutMs: step.timeoutMs
        })
        runningScriptRef.current = null
        appendLog(
          `${step.script} => ok=${r.ok} status=${r.status}${step.elevated ? ' [elevated]' : ''}`
        )
        if (r.details && Object.keys(r.details).length > 0) {
          if (!r.ok || (r.warnings.length > 0 && step.id === 'docker-install')) {
            appendLog(`details: ${JSON.stringify(r.details).slice(0, 4000)}`)
          }
        }
        setMessages((m) => m.map((v, idx) => (idx === i ? r.message : v)))
        setStates((s) =>
          s.map((v, idx) =>
            idx === i ? (r.ok ? (r.warnings.length ? 'warning' : 'success') : 'error') : v
          )
        )
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
        setStates((s) => s.map((v, idx) => (idx === i ? 'error' : v)))
        setMessages((m) => m.map((v, idx) => (idx === i ? String(e) : v)))
        break
      }
    }
  }

  return (
    <div>
      <h1 className="page-title">Install Wizard</h1>
      <p className="page-sub">
        Guided setup. Some steps request Windows administrator approval (UAC) and then resume.
      </p>

      <div className="row-actions" style={{ marginBottom: 16 }}>
        <ActionButton variant="primary" onClick={() => void runAll()}>
          Run install flow
        </ActionButton>
      </div>

      <div className="stack">
        {STEPS.map((s, idx) => (
          <StepCard
            key={s.id}
            index={idx + 1}
            title={s.title}
            message={messages[idx] ?? ''}
            state={states[idx] ?? 'pending'}
            runningStatusLabel={RUNNING_STATUS_LABEL[s.id]}
            showIndeterminateProgress
          />
        ))}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Log</h3>
        <LogPanel text={log} />
      </div>
    </div>
  )
}
