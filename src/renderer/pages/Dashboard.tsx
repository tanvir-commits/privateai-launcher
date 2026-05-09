import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { defaultDashboardStatus, type DashboardStatus } from '@shared/dashboardTypes'
import type { ScriptResult } from '@shared/scriptContract'
import { ActionButton } from '../components/ActionButton'
import { StatusCard } from '../components/StatusCard'
import { UrlCard } from '../components/UrlCard'
import { LogPanel } from '../components/LogPanel'
import { serviceLabel, serviceTone } from '../lib/serviceUi'

function readSuggestedRepair(r: ScriptResult): { code: string; title: string } | null {
  if (r.ok) return null
  const code = r.details?.suggestedRepairCode
  if (typeof code !== 'string' || code.length === 0) return null
  if (code === 'OPENWEBUI_CONTAINER_STOPPED') {
    return { code, title: 'Start Open Web UI container' }
  }
  return null
}

/** Open WebUI may run install-openwebui.ps1 (pull + run) when the container is missing. */
const RESTART_TIMEOUT_MS = 300_000

export default function Dashboard() {
  const [status, setStatus] = useState<DashboardStatus>(defaultDashboardStatus)
  const [healthLog, setHealthLog] = useState<string>('')
  const [healthRepair, setHealthRepair] = useState<{ code: string; title: string } | null>(null)
  const [restarting, setRestarting] = useState<'docker' | 'ollama' | 'openWebui' | null>(null)
  const [statusProbePending, setStatusProbePending] = useState(false)

  /** Fast: last merged dashboard (from prior health / refresh). */
  const loadCachedStatus = useCallback(async () => {
    try {
      setStatus(await window.privateai.getStatus())
    } catch {
      /* IPC/preload not ready yet */
    }
  }, [])

  /** Slow: runs health-check.ps1 again — use for Refresh status and after Restart. */
  const probeAndUpdateStatus = useCallback(async () => {
    setStatusProbePending(true)
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    try {
      setStatus(await window.privateai.refreshStatus())
    } catch {
      await loadCachedStatus()
    } finally {
      setStatusProbePending(false)
    }
  }, [loadCachedStatus])

  useEffect(() => {
    void loadCachedStatus()
  }, [loadCachedStatus])

  const runHealth = async () => {
    setHealthLog('Running health check…')
    setHealthRepair(null)
    const r = (await window.privateai.runHealth()) as ScriptResult
    setHealthLog(JSON.stringify(r, null, 2))
    setHealthRepair(readSuggestedRepair(r))
    await loadCachedStatus()
  }

  const runDockerEngineRestart = async () => {
    setRestarting('docker')
    try {
      const r = (await window.privateai.runRepair('DOCKER_ENGINE_WINDOWS')) as ScriptResult
      if (!r.ok) {
        setHealthLog(
          (prev) => `${prev}\n--- Docker engine repair ---\n${JSON.stringify(r, null, 2)}\n`
        )
      }
      await probeAndUpdateStatus()
    } catch (e) {
      setHealthLog((prev) => `${prev}\n--- Docker engine repair failed ---\n${String(e)}\n`)
      await probeAndUpdateStatus()
    } finally {
      setRestarting(null)
    }
  }

  const runServiceRestart = async (target: 'ollama' | 'openWebui') => {
    const app = target === 'ollama' ? 'Ollama' : 'OpenWebUi'
    setRestarting(target)
    try {
      const result = await window.privateai.runScript(
        'manage-app.ps1',
        { App: app, Action: 'Restart' },
        { timeoutMs: RESTART_TIMEOUT_MS }
      )
      if (!result.ok) {
        setHealthLog(
          (prev) =>
            `${prev}\n--- Restart: ${app} ---\n${JSON.stringify(result, null, 2)}\n`
        )
      }
      await probeAndUpdateStatus()
    } catch (e) {
      setHealthLog((prev) => `${prev}\n--- Restart failed (${app}) ---\n${String(e)}\n`)
      await probeAndUpdateStatus()
    } finally {
      setRestarting(null)
    }
  }

  const runSuggestedRepair = async () => {
    if (!healthRepair) return
    setHealthLog((prev) => `${prev}\n\n--- ${healthRepair.title} (repair:${healthRepair.code}) ---\n`)
    const r = (await window.privateai.runRepair(healthRepair.code)) as ScriptResult
    setHealthLog((prev) => `${prev}${JSON.stringify(r, null, 2)}`)
    setHealthRepair(null)
    await loadCachedStatus()
    const h = (await window.privateai.runHealth()) as ScriptResult
    setHealthLog((prev) => `${prev}\n\n--- Health check (after repair) ---\n${JSON.stringify(h, null, 2)}`)
    setHealthRepair(readSuggestedRepair(h))
    await loadCachedStatus()
  }

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <p className="page-sub">
        Live view of your stack after setup. Use <Link to="/install">Install Wizard</Link> for first-time
        setup or deep installs. <strong>Restart</strong> on Docker runs engine repair and attempts to start
        a stopped Open WebUI container; Ollama and Open WebUI cards restart those apps directly.{' '}
        <strong>Refresh status</strong> re-runs the health probe (can
        take up to a minute).
      </p>

      {statusProbePending ? (
        <p className="muted" style={{ marginBottom: 12, fontSize: 13 }}>
          Checking services… (this can take up to a minute)
        </p>
      ) : null}
      <div className="row-actions" style={{ marginBottom: 18 }}>
        <ActionButton
          variant="primary"
          disabled={statusProbePending}
          onClick={() => void probeAndUpdateStatus()}
        >
          {statusProbePending ? 'Checking…' : 'Refresh status'}
        </ActionButton>
        <ActionButton onClick={() => void runHealth()}>Run health check</ActionButton>
        <ActionButton
          onClick={() => void window.privateai.openExternal(status.localChatUrl)}
        >
          Open chat UI
        </ActionButton>
        <Link className="btn btn-ghost" to="/troubleshooting" style={{ textDecoration: 'none', fontSize: 13 }}>
          Troubleshooting
        </Link>
        <Link className="btn btn-ghost" to="/services" style={{ textDecoration: 'none', fontSize: 13 }}>
          Script checks
        </Link>
      </div>

      <h2 className="dash-section-title">Apps</h2>
      <div className="grid cols-2">
        <StatusCard
          title="Docker Desktop"
          description="Engine runs your containers; Restart brings the service up and tries to start the Open WebUI container if it was stopped."
          tone={serviceTone(status.docker)}
          label={serviceLabel(status.docker)}
          subtitle={
            status.docker === 'running' && status.dockerVersion
              ? `Engine ${status.dockerVersion}`
              : undefined
          }
          headerAction={
            <ActionButton
              variant="default"
              style={{ fontSize: 12, padding: '7px 14px', flexShrink: 0 }}
              disabled={restarting !== null || statusProbePending}
              onClick={() => void runDockerEngineRestart()}
            >
              {restarting === 'docker' ? '…' : 'Restart'}
            </ActionButton>
          }
        />
        <StatusCard
          title="Ollama"
          tone={serviceTone(status.ollama)}
          label={serviceLabel(status.ollama)}
          headerAction={
            <ActionButton
              variant="default"
              style={{ fontSize: 12, padding: '7px 14px', flexShrink: 0 }}
              disabled={restarting !== null || statusProbePending}
              onClick={() => void runServiceRestart('ollama')}
            >
              {restarting === 'ollama' ? '…' : 'Restart'}
            </ActionButton>
          }
        />
        <StatusCard
          title="Open WebUI"
          tone={serviceTone(status.openWebui)}
          label={serviceLabel(status.openWebui)}
          headerAction={
            <ActionButton
              variant="default"
              style={{ fontSize: 12, padding: '7px 14px', flexShrink: 0 }}
              disabled={restarting !== null || statusProbePending}
              onClick={() => void runServiceRestart('openWebui')}
            >
              {restarting === 'openWebui' ? '…' : 'Restart'}
            </ActionButton>
          }
        />
        <StatusCard
          title="ComfyUI"
          tone={serviceTone(status.comfyui)}
          label={serviceLabel(status.comfyui)}
        />
      </div>

      <div className="dash-section">
        <h2 className="dash-section-title">Links</h2>
        <div className="grid cols-2">
          <UrlCard title="Local chat" url={status.localChatUrl} />
          <UrlCard title="Phone / LAN" url={status.lanChatUrl || 'Run health check to detect LAN URL'} />
        </div>
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        <h3>Last health check</h3>
        <p className="muted">{status.lastHealthAt ?? 'Not run yet'}</p>
        <p className="muted">{status.lastHealthSummary ?? '—'}</p>
        {healthRepair ? (
          <div className="row-actions" style={{ marginBottom: 12 }}>
            <ActionButton variant="primary" onClick={() => void runSuggestedRepair()}>
              {healthRepair.title}
            </ActionButton>
            <span className="muted" style={{ fontSize: 12 }}>
              Suggested from last health result ({healthRepair.code})
            </span>
          </div>
        ) : null}
        <LogPanel text={healthLog} />
      </div>
    </div>
  )
}
