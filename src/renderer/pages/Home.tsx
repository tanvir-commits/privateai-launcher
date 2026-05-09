import { useCallback, useEffect, useState } from 'react'
import { defaultDashboardStatus, type DashboardStatus } from '@shared/dashboardTypes'
import { ActionButton } from '../components/ActionButton'
import { StatusCard } from '../components/StatusCard'
import { UrlCard } from '../components/UrlCard'
import { LogPanel } from '../components/LogPanel'
import { serviceLabel, serviceTone } from '../lib/serviceUi'

export default function Home() {
  const [status, setStatus] = useState<DashboardStatus>(defaultDashboardStatus)
  const [healthLog, setHealthLog] = useState<string>('')

  const refresh = useCallback(async () => {
    setStatus(await window.privateai.getStatus())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const runHealth = async () => {
    setHealthLog('Running health check…')
    const r = await window.privateai.runHealth()
    setHealthLog(JSON.stringify(r, null, 2))
    await refresh()
  }

  return (
    <div>
      <h1 className="page-title">Home</h1>
      <p className="page-sub">Overall state of your private AI stack.</p>

      <div className="row-actions" style={{ marginBottom: 18 }}>
        <ActionButton variant="primary" onClick={() => void refresh()}>
          Refresh status
        </ActionButton>
        <ActionButton onClick={() => void runHealth()}>Run health check</ActionButton>
        <ActionButton
          onClick={() => void window.privateai.openExternal(status.localChatUrl)}
        >
          Open chat UI
        </ActionButton>
      </div>

      <div className="grid cols-2">
        <StatusCard
          title="PC readiness"
          tone={status.readiness === 'unsupported' ? 'bad' : status.readiness === 'unknown' ? 'unknown' : 'ok'}
          label={status.pcReadinessLabel}
        />
        <StatusCard
          title="Ollama"
          tone={serviceTone(status.ollama)}
          label={serviceLabel(status.ollama)}
        />
        <StatusCard
          title="Open WebUI"
          tone={serviceTone(status.openWebui)}
          label={serviceLabel(status.openWebui)}
        />
        <StatusCard
          title="ComfyUI"
          tone={serviceTone(status.comfyui)}
          label={serviceLabel(status.comfyui)}
        />
      </div>

      <div style={{ marginTop: 18 }} className="grid cols-2">
        <UrlCard title="Local chat" url={status.localChatUrl} />
        <UrlCard title="Phone / LAN" url={status.lanChatUrl || 'Run health check to detect LAN URL'} />
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h3>Last health check</h3>
        <p className="muted">{status.lastHealthAt ?? 'Not run yet'}</p>
        <p className="muted">{status.lastHealthSummary ?? '—'}</p>
        <LogPanel text={healthLog} />
      </div>
    </div>
  )
}
