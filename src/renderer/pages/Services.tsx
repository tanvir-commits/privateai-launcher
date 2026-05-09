import { useCallback, useEffect, useState } from 'react'
import { defaultDashboardStatus, type DashboardStatus, type ServiceState } from '@shared/dashboardTypes'
import { ActionButton } from '../components/ActionButton'
import { StatusCard } from '../components/StatusCard'
import { serviceLabel, serviceTone } from '../lib/serviceUi'

export default function Services() {
  const [status, setStatus] = useState<DashboardStatus>(defaultDashboardStatus)

  const refresh = useCallback(async () => {
    const r = await window.privateai.runHealth()
    // Health JSON includes service hints; until wired, refresh dashboard summary.
    void r
    setStatus(await window.privateai.getStatus())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const row = (label: string, state: ServiceState) => (
    <StatusCard title={label} tone={serviceTone(state)} label={serviceLabel(state)} />
  )

  return (
    <div>
      <h1 className="page-title">Services</h1>
      <p className="page-sub">Start, stop, and repair local services (Ollama, Open WebUI, ComfyUI).</p>

      <div className="row-actions" style={{ marginBottom: 16 }}>
        <ActionButton variant="primary" onClick={() => void refresh()}>
          Refresh
        </ActionButton>
        <ActionButton onClick={() => void window.privateai.runScript('check-ollama.ps1')}>
          Check Ollama
        </ActionButton>
        <ActionButton onClick={() => void window.privateai.runScript('check-docker.ps1')}>
          Check Docker
        </ActionButton>
        <ActionButton onClick={() => void window.privateai.runScript('check-comfyui.ps1')}>
          Check ComfyUI
        </ActionButton>
      </div>

      <div className="grid cols-2">
        {row('Ollama', status.ollama)}
        {row('Open WebUI', status.openWebui)}
        {row('ComfyUI', status.comfyui)}
      </div>

      <p className="muted" style={{ marginTop: 16 }}>
        v0.1 uses scripts for checks. Start/stop orchestration will map to the same scripts in a later
        polish pass.
      </p>
    </div>
  )
}
