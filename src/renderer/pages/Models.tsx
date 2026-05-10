import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import modelProfiles from '@config/model-profiles.json'
import ports from '@config/ports.json'
import type { HardwareScanPayload } from '@shared/preloadApi'
import type { ScriptResult } from '@shared/scriptContract'
import { ActionButton } from '../components/ActionButton'
import { LogPanel } from '../components/LogPanel'
import type { ModelFitLabel } from '../lib/modelHardwareFit'
import {
  hardwareSummaryLine,
  sortProfilesByHardwareFit,
  type ModelProfileRow
} from '../lib/modelHardwareFit'

function readOllamaModelList(details: Record<string, unknown> | undefined): string[] | null {
  if (!details || !Array.isArray(details.models)) return null
  const out: string[] = []
  for (const x of details.models) {
    if (typeof x === 'string' && x.length > 0) out.push(x)
  }
  return out.length ? out : []
}

function fitPillClass(label: ModelFitLabel): string {
  return `model-fit-pill model-fit-pill--${label}`
}

function fitPillText(label: ModelFitLabel): string {
  switch (label) {
    case 'ideal':
      return 'Best match'
    case 'ok':
      return 'OK'
    case 'substitute':
      return 'Smaller pull suggested'
    case 'tight':
      return 'Tight'
    case 'blocked':
      return 'Poor match'
    default:
      return ''
  }
}

export default function Models() {
  const profiles = modelProfiles.profiles as ModelProfileRow[]
  const [installed, setInstalled] = useState<string[] | null>(null)
  const [customModel, setCustomModel] = useState('llama3.2:3b')
  const [log, setLog] = useState('')
  const [busyRefresh, setBusyRefresh] = useState(false)
  const [busyPullId, setBusyPullId] = useState<string | null>(null)
  const [lastHw, setLastHw] = useState<HardwareScanPayload | null>(null)
  const [hwFetched, setHwFetched] = useState(false)
  const [busyHwScan, setBusyHwScan] = useState(false)

  const openWebUiUrl = `http://127.0.0.1:${ports.openWebui}`

  useEffect(() => {
    let cancelled = false
    void window.privateai.getLastHardwareScan().then((s) => {
      if (!cancelled) {
        setLastHw(s)
        setHwFetched(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const rescanHardware = useCallback(async () => {
    setBusyHwScan(true)
    try {
      const s = await window.privateai.scanHardware()
      setLastHw(s)
      setHwFetched(true)
    } finally {
      setBusyHwScan(false)
    }
  }, [])

  const sortedProfiles = useMemo(
    () => sortProfilesByHardwareFit(profiles, lastHw),
    [profiles, lastHw]
  )

  const hwSummary = hardwareSummaryLine(lastHw)

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
        (Settings → Models). Starters below are <strong>ordered for this machine</strong> when a hardware snapshot
        exists (same scan as Check my PC).
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Match models to this PC</h3>
        {!hwFetched ? (
          <p className="muted">Loading last hardware snapshot…</p>
        ) : lastHw?.error ? (
          <p className="muted">Hardware snapshot failed: {lastHw.error}</p>
        ) : !lastHw ? (
          <p className="muted" style={{ marginBottom: 12 }}>
            No snapshot yet. Run <NavLink to="/check-my-pc">Check my PC</NavLink> once, or scan from here — then we
            sort starters by GPU VRAM and RAM and suggest smaller pulls when VRAM is tight.
          </p>
        ) : (
          <>
            {hwSummary ? (
              <p className="muted" style={{ marginBottom: 10 }}>
                Using: {hwSummary}
              </p>
            ) : (
              <p className="muted" style={{ marginBottom: 10 }}>
                Hardware snapshot loaded; details incomplete — re-scan if this looks wrong.
              </p>
            )}
            <div className="row-actions" style={{ marginTop: 0 }}>
              <ActionButton variant="ghost" disabled={busyHwScan} onClick={() => void rescanHardware()}>
                {busyHwScan ? 'Scanning…' : 'Re-scan hardware'}
              </ActionButton>
              <NavLink to="/check-my-pc" className="btn btn-ghost">
                Open Check my PC
              </NavLink>
            </div>
          </>
        )}
        {hwFetched && !lastHw?.error ? (
          <p className="muted" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
            Thresholds come from <code>config/model-profiles.json</code> — tune <code>minVramGb</code>,{' '}
            <code>minRamGb</code>, and <code>cpuFallbackPull</code> if you want different guidance.
          </p>
        ) : null}
      </div>

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
        Curated in <code>config/model-profiles.json</code>. Order and badges update from your last hardware snapshot.
      </p>

      <div className="stack">
        {sortedProfiles.map(({ profile: p, fit }) => {
          const pullTag = fit.effectivePull
          const showCatalog = pullTag && p.ollamaPull && pullTag !== p.ollamaPull
          const pullDisabled = !pullTag || busyPullId !== null || fit.label === 'blocked'
          return (
            <div key={p.id} className="card">
              <h3 style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <span>{p.label}</span>
                <span className={fitPillClass(fit.label)} title={fit.hint}>
                  {fitPillText(fit.label)}
                </span>
              </h3>
              <p className="muted">{p.description}</p>
              <p className="muted">{fit.hint}</p>
              {pullTag ? (
                <p className="muted">
                  Suggested pull: <code style={{ fontSize: '0.9em' }}>{pullTag}</code>
                  {showCatalog ? (
                    <>
                      {' '}
                      (catalog card: <code style={{ fontSize: '0.9em' }}>{p.ollamaPull}</code>)
                    </>
                  ) : null}
                </p>
              ) : (
                <p className="muted">No Ollama pull for this card — see description.</p>
              )}
              <p className="muted">Approx size: {p.approxSizeGb ?? '?'} GB</p>
              <div className="row-actions">
                <ActionButton
                  variant="primary"
                  disabled={pullDisabled}
                  onClick={() => pullTag && void pullModel(pullTag, p.id)}
                >
                  {busyPullId === p.id ? 'Pulling…' : 'Pull suggested model'}
                </ActionButton>
              </div>
            </div>
          )
        })}
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
