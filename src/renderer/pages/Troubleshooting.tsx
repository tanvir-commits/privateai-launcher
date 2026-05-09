import { useState } from 'react'
import { ActionButton } from '../components/ActionButton'
import { LogPanel } from '../components/LogPanel'

const COMMON: { code: string; title: string; hint: string }[] = [
  {
    code: 'OLLAMA_NOT_RUNNING',
    title: 'Ollama not running',
    hint: 'Repairs try to start the Ollama service or launch the app.'
  },
  {
    code: 'OPENWEBUI_CONTAINER_STOPPED',
    title: 'Open WebUI container stopped',
    hint: 'Repairs recreate or start the Docker container on port 3000.'
  },
  {
    code: 'OPENWEBUI_CANNOT_REACH_OLLAMA',
    title: 'Open WebUI cannot reach Ollama',
    hint: 'Usually Docker networking: host.docker.internal vs localhost.'
  },
  {
    code: 'COMFYUI_NOT_RUNNING',
    title: 'ComfyUI not running',
    hint: 'Repairs check port 8188 and suggest starting ComfyUI.'
  },
  {
    code: 'PORT_BUSY',
    title: 'Port busy',
    hint: 'Repairs identify the owning process (no auto-kill).'
  }
]

export default function Troubleshooting() {
  const [log, setLog] = useState<string>('Pick a repair code.')

  const run = async (code: string) => {
    setLog(`Running repair: ${code}…`)
    const r = await window.privateai.runRepair(code)
    setLog(JSON.stringify(r, null, 2))
  }

  return (
    <div>
      <h1 className="page-title">Troubleshooting</h1>
      <p className="page-sub">Plain-language fixes for common failures.</p>

      <div className="stack">
        {COMMON.map((c) => (
          <div key={c.code} className="card">
            <h3>{c.title}</h3>
            <p className="muted">{c.hint}</p>
            <div className="row-actions">
              <ActionButton variant="primary" onClick={() => void run(c.code)}>
                Repair
              </ActionButton>
              <span className="muted" style={{ fontSize: 12 }}>
                {c.code}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>Last result</h3>
        <LogPanel text={log} />
      </div>
    </div>
  )
}
