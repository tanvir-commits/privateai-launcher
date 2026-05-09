import { useCallback, useEffect, useState } from 'react'
import { defaultDashboardStatus, type DashboardStatus } from '@shared/dashboardTypes'
import type { ScriptResult } from '@shared/scriptContract'
import { ActionButton } from '../components/ActionButton'
import { LogPanel } from '../components/LogPanel'
import { serviceLabel, serviceTone } from '../lib/serviceUi'
import { StatusCard } from '../components/StatusCard'

type ManageAppId = 'Ollama' | 'OpenWebUi' | 'DockerDesktop' | 'ComfyPortable'

const UNINSTALL_TIMEOUT_MS: Record<ManageAppId, number> = {
  Ollama: 180_000,
  OpenWebUi: 180_000,
  DockerDesktop: 900_000,
  ComfyPortable: 180_000
}

type Row = {
  id: ManageAppId
  title: string
  description: string
  statusKey: keyof Pick<DashboardStatus, 'docker' | 'ollama' | 'openWebui' | 'comfyui'>
  subtitle?: (s: DashboardStatus) => string | undefined
}

const ROWS: Row[] = [
  {
    id: 'Ollama',
    title: 'Ollama',
    description: 'Local LLM runtime (winget package Ollama.Ollama). Uninstall removes the app; model files under your user profile may remain until you delete them.',
    statusKey: 'ollama'
  },
  {
    id: 'DockerDesktop',
    title: 'Docker Desktop',
    description: 'Container engine (winget Docker.DockerDesktop). Uninstall stops all containers; reboot afterward if Windows still shows Docker components.',
    statusKey: 'docker',
    subtitle: (s) => (s.dockerVersion ? `Engine ${s.dockerVersion}` : undefined)
  },
  {
    id: 'OpenWebUi',
    title: 'Open WebUI',
    description:
      'Docker container `privateai-open-webui`. Uninstall removes the container only; chat data in Docker volume `open-webui` is kept unless you delete that volume manually.',
    statusKey: 'openWebui'
  },
  {
    id: 'ComfyPortable',
    title: 'ComfyUI (portable)',
    description: 'Folder under %LOCALAPPDATA%\\PrivateAI\\ComfyUI_windows_portable from the Install wizard. Close ComfyUI before uninstalling.',
    statusKey: 'comfyui'
  }
]

export default function InstalledApps() {
  const [status, setStatus] = useState<DashboardStatus>(defaultDashboardStatus)
  const [busy, setBusy] = useState<ManageAppId | null>(null)
  const [log, setLog] = useState('')

  const appendLog = useCallback((line: string) => {
    setLog((prev) => (prev ? `${prev}\n${line}` : line))
  }, [])

  const refresh = useCallback(async () => {
    try {
      setStatus(await window.privateai.refreshStatus())
    } catch {
      try {
        setStatus(await window.privateai.getStatus())
      } catch {
        /* preload not ready */
      }
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const uninstall = async (row: Row) => {
    if (
      !window.confirm(
        `Uninstall ${row.title}?\n\nThis cannot be undone from the launcher. For details, read the card text on this page.`
      )
    ) {
      return
    }
    setBusy(row.id)
    appendLog(`--- Uninstall: ${row.id} ---`)
    try {
      const r: ScriptResult = await window.privateai.runScript(
        'manage-app.ps1',
        { App: row.id, Action: 'Uninstall' },
        { timeoutMs: UNINSTALL_TIMEOUT_MS[row.id] }
      )
      appendLog(JSON.stringify(r, null, 2))
      if (!r.ok) {
        appendLog(`FAILED: ${r.message}`)
      }
    } catch (e) {
      appendLog(`ERROR: ${String(e)}`)
    } finally {
      setBusy(null)
      await refresh()
    }
  }

  return (
    <div>
      <h1 className="page-title">Installed apps</h1>
      <p className="page-sub">
        Remove stack components installed through this launcher or winget. Status comes from the last health
        probe — use <strong>Refresh</strong> after an uninstall. To remove <strong>PrivateAI Launcher</strong>{' '}
        itself, use Windows{' '}
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: 'inherit', padding: '0 4px', verticalAlign: 'baseline' }}
          onClick={() => void window.privateai.openExternal('ms-settings:appsfeatures')}
        >
          Installed apps
        </button>{' '}
        (Settings).
      </p>

      <div className="row-actions" style={{ marginBottom: 18 }}>
        <ActionButton variant="primary" disabled={busy !== null} onClick={() => void refresh()}>
          Refresh status
        </ActionButton>
      </div>

      <div className="grid cols-2">
        {ROWS.map((row) => {
          const st = status[row.statusKey]
          const tone = serviceTone(st)
          const label = serviceLabel(st)
          const sub = row.subtitle?.(status)
          return (
            <StatusCard
              key={row.id}
              title={row.title}
              description={row.description}
              tone={tone}
              label={label}
              subtitle={sub}
              headerAction={
                <ActionButton
                  disabled={busy !== null}
                  style={{
                    fontSize: 12,
                    padding: '7px 14px',
                    flexShrink: 0,
                    border: '1px solid var(--danger)',
                    color: 'var(--danger)'
                  }}
                  onClick={() => void uninstall(row)}
                >
                  {busy === row.id ? '…' : 'Uninstall'}
                </ActionButton>
              }
            />
          )
        })}
      </div>

      <div className="card" style={{ marginTop: 22 }}>
        <h3>Uninstall log</h3>
        <p className="muted" style={{ fontSize: 12 }}>
          JSON responses from manage-app.ps1 appear below.
        </p>
        <LogPanel text={log} />
      </div>
    </div>
  )
}
