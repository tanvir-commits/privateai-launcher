import { useCallback, useState } from 'react'
import modelProfiles from '@config/model-profiles.json'
import ports from '@config/ports.json'
import type { ScriptResult } from '@shared/scriptContract'
import { ActionButton } from '../components/ActionButton'
import { LogPanel } from '../components/LogPanel'

type ProfileFile = typeof modelProfiles

function readOllamaModelList(details: Record<string, unknown> | undefined): string[] | null {
  if (!details || !Array.isArray(details.models)) return null
  const out: string[] = []
  for (const x of details.models) {
    if (typeof x === 'string' && x.length > 0) out.push(x)
  }
  return out.length ? out : []
}

export default function Models() {
  const [profiles] = useState<ProfileFile['profiles']>(() => modelProfiles.profiles)
  const [installed, setInstalled] = useState<string[] | null>(null)
  const [customModel, setCustomModel] = useState('llama3.2:3b')
  const [log, setLog] = useState('')
  const [busyRefresh, setBusyRefresh] = useState(false)
  const [busyPullId, setBusyPullId] = useState<string | null>(null)

  const openWebUiUrl = `http://127.0.0.1:${ports.openWebui}`

  const refreshInstalled = useCallback(async () => {
    setBusyRefresh(true)
    try {
      const r: ScriptResult = await window.privateai.runScript('check-ollama.ps1')
      setLog(JSON.stringify(r, null, 2))
      if (r.ok) {
        setInstalled(readOllamaModelList(r.details as Record<string, unknown>))
      } else {
        setInstalled(null)
      }
    } finally {
      setBusyRefresh(false)
    }
  }, [])

  const pullModel = async (model: string, busyKey: string) => {
    const m = model.trim()
    if (!m) return
    setBusyPullId(busyKey)
    try {
      const r: ScriptResult = await window.privateai.runScript(
        'download-models.ps1',
        { Model: m },
        { timeoutMs: 600_000 }
      )
      setLog(JSON.stringify(r, null, 2))
      if (r.ok) await refreshInstalled()
    } finally {
      setBusyPullId(null)
    }
  }

  return (
    <div>
      <h1 className="page-title">Models</h1>
      <p className="page-sub">
        Open WebUI uses whatever <strong>Ollama</strong> exposes on this PC — there is no separate model store in
        the launcher. Pull models here (or with <code style={{ fontSize: '0.9em' }}>ollama pull</code> in a
        terminal); they show up in Open WebUI after a refresh. Pick defaults and per-chat models inside Open WebUI
        (Settings → Models).
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Open WebUI</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          After pulls finish, open the chat UI and choose a model from the selector at the top of a conversation.
        </p>
        <div className="row-actions" style={{ marginTop: 0 }}>
          <ActionButton variant="primary" onClick={() => void window.privateai.openExternal(openWebUiUrl)}>
            Open chat UI
          </ActionButton>
          <ActionButton
            variant="default"
            onClick={() => void window.privateai.openExternal('https://ollama.com/library')}
          >
            Browse Ollama library
          </ActionButton>
          <ActionButton variant="ghost" disabled={busyRefresh} onClick={() => void refreshInstalled()}>
            {busyRefresh ? 'Refreshing…' : 'Refresh list from Ollama'}
          </ActionButton>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Installed in Ollama</h3>
        {installed === null ? (
          <p className="muted">Click &quot;Refresh list from Ollama&quot; above to load model tags from this machine.</p>
        ) : installed.length === 0 ? (
          <p className="muted">No models reported yet — pull a starter below or a custom tag.</p>
        ) : (
          <ul className="muted" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
            {installed.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3>Pull any Ollama model</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          Use the same <code style={{ fontSize: '0.9em' }}>name:tag</code> you would pass to <code>ollama pull</code>{' '}
          (examples: <code>llama3.2:3b</code>, <code>mistral:7b</code>). Large downloads can take many minutes.
        </p>
        <div className="row-actions" style={{ marginTop: 0, alignItems: 'center' }}>
          <input
            className="models-field"
            aria-label="Ollama model name and tag"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            placeholder="e.g. llama3.2:3b"
          />
          <ActionButton
            variant="primary"
            disabled={busyPullId !== null || !customModel.trim()}
            onClick={() => void pullModel(customModel, 'custom')}
          >
            {busyPullId === 'custom' ? 'Pulling…' : 'Pull model'}
          </ActionButton>
        </div>
      </div>

      <h2 className="hw-details-title" style={{ marginTop: 8 }}>
        Recommended starters
      </h2>
      <p className="muted" style={{ marginBottom: 14, fontSize: 14 }}>
        Curated list from <code>config/model-profiles.json</code> — edit that file if you want different presets in
        the launcher.
      </p>

      <div className="stack">
        {profiles.map((p) => (
          <div key={p.id} className="card">
            <h3>{p.label}</h3>
            <p className="muted">{p.description}</p>
            <p className="muted">Ollama pull: {p.ollamaPull ?? '—'}</p>
            <p className="muted">Approx size: {p.approxSizeGb ?? '?'} GB</p>
            <div className="row-actions">
              <ActionButton
                variant="primary"
                disabled={!p.ollamaPull || busyPullId !== null}
                onClick={() => p.ollamaPull && void pullModel(p.ollamaPull, p.id)}
              >
                {busyPullId === p.id ? 'Pulling…' : 'Pull via launcher script'}
              </ActionButton>
            </div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <h3>Last script output</h3>
        <p className="muted" style={{ marginBottom: 8, fontSize: 12 }}>
          Pull and refresh commands write JSON here for troubleshooting.
        </p>
        <LogPanel text={log} />
      </div>
    </div>
  )
}
