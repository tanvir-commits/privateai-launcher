import { useMemo, useState } from 'react'
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

export default function InstallWizard() {
  const initial = useMemo(() => STEPS.map(() => 'pending' as StepState), [])
  const [states, setStates] = useState<StepState[]>(initial)
  const [messages, setMessages] = useState<string[]>(() => STEPS.map(() => 'Waiting'))
  const [log, setLog] = useState<string>('')

  const appendLog = (line: string) => {
    setLog((prev) => (prev ? `${prev}\n${line}` : line))
  }

  const runAll = async () => {
    setLog('')
    for (let i = 0; i < STEPS.length; i++) {
      const step = STEPS[i]!
      setStates((s) => s.map((v, idx) => (idx === i ? 'running' : v)))
      setMessages((m) => m.map((v, idx) => (idx === i ? 'Running script…' : v)))
      try {
        if (!step.script) {
          setStates((s) => s.map((v, idx) => (idx === i ? 'success' : v)))
          setMessages((m) => m.map((v, idx) => (idx === i ? 'No script for this step yet.' : v)))
          continue
        }
        const r: ScriptResult = await window.privateai.runScript(step.script, undefined, {
          elevated: step.elevated,
          timeoutMs: step.timeoutMs
        })
        appendLog(
          `${step.script} => ok=${r.ok} status=${r.status}${step.elevated ? ' [elevated]' : ''}`
        )
        if (!r.ok && r.details && Object.keys(r.details).length > 0) {
          appendLog(`details: ${JSON.stringify(r.details).slice(0, 4000)}`)
        }
        setMessages((m) => m.map((v, idx) => (idx === i ? r.message : v)))
        setStates((s) =>
          s.map((v, idx) =>
            idx === i ? (r.ok ? (r.warnings.length ? 'warning' : 'success') : 'error') : v
          )
        )
        if (!r.ok) break
      } catch (e) {
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
