import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NavLink } from 'react-router-dom'
import modelProfiles from '@config/model-profiles.json'
import ollamaModelPicks from '@config/ollama-model-picks.json'
import ports from '@config/ports.json'
import type { HardwareScanPayload } from '@shared/preloadApi'
import type { ScriptProgressEvent } from '@shared/scriptProgress'
import type { ScriptResult } from '@shared/scriptContract'
import { ActionButton } from '../components/ActionButton'
import { LogPanel } from '../components/LogPanel'
import type { ModelFitLabel } from '../lib/modelHardwareFit'
import {
  hardwareSummaryLine,
  sortProfilesByHardwareFit,
  type ModelProfileRow
} from '../lib/modelHardwareFit'

type OllamaPick = { tag: string; title: string; note?: string }

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

function hintShort(s: string, max = 110): string {
  const t = s.trim()
  if (t.length <= max) return t
  return t.slice(0, max - 1) + '…'
}

function pullProgressLine(ev: ScriptProgressEvent | null, model: string): { text: string; pct: number | null } {
  if (!ev) return { text: `Preparing download of ${model}…`, pct: null }
  const d = ev.detail?.trim()
  if (typeof ev.percent === 'number') {
    return {
      text: d ? `Downloading ${model} — ${ev.percent}% — ${d}` : `Downloading ${model} — ${ev.percent}%`,
      pct: ev.percent
    }
  }
  return {
    text: d ? `Downloading ${model} — ${d}` : `Downloading ${model}…`,
    pct: null
  }
}

export default function Models() {
  const profiles = modelProfiles.profiles as ModelProfileRow[]
  const curatedPicks = ollamaModelPicks.picks as OllamaPick[]
  const [installed, setInstalled] = useState<string[] | null>(null)
  const [pickerText, setPickerText] = useState('llama3.2:3b')
  const [pickerMenuOpen, setPickerMenuOpen] = useState(false)
  const [log, setLog] = useState('')
  const [busyRefresh, setBusyRefresh] = useState(false)
  const [busyPullId, setBusyPullId] = useState<string | null>(null)
  const [lastHw, setLastHw] = useState<HardwareScanPayload | null>(null)
  const [hwFetched, setHwFetched] = useState(false)
  const [busyHwScan, setBusyHwScan] = useState(false)
  const [pullProgress, setPullProgress] = useState<ScriptProgressEvent | null>(null)
  const [pullModelName, setPullModelName] = useState<string | null>(null)
  const progressUnsubRef = useRef<(() => void) | null>(null)
  const userEditedPickerRef = useRef(false)

  const openWebUiUrl = `http://127.0.0.1:${ports.openWebui}`

  useEffect(() => {
    return () => {
      progressUnsubRef.current?.()
      progressUnsubRef.current = null
    }
  }, [])

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

  const suggestedDefaultTag = useMemo(() => {
    const hit = sortedProfiles.find(({ fit }) => fit.effectivePull && fit.label !== 'blocked')
    return hit?.fit.effectivePull ?? 'llama3.2:3b'
  }, [sortedProfiles])

  useEffect(() => {
    if (userEditedPickerRef.current) return
    setPickerText(suggestedDefaultTag)
  }, [suggestedDefaultTag])

  const topPicks = useMemo(
    () =>
      sortedProfiles
        .filter(({ fit }) => fit.effectivePull && fit.label !== 'blocked')
        .slice(0, 5),
    [sortedProfiles]
  )

  const filteredCurated = useMemo(() => {
    const q = pickerText.trim().toLowerCase()
    if (!q) return curatedPicks.slice(0, 12)
    return curatedPicks
      .filter((p) => {
        const blob = `${p.tag} ${p.title} ${p.note ?? ''}`.toLowerCase()
        return blob.includes(q)
      })
      .slice(0, 12)
  }, [curatedPicks, pickerText])

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

  const pullModel = useCallback(
    async (model: string, busyKey: string) => {
      const m = model.trim()
      if (!m) return
      progressUnsubRef.current?.()
      progressUnsubRef.current = null
      setBusyPullId(busyKey)
      setPullModelName(m)
      setPullProgress(null)
      const token = globalThis.crypto.randomUUID()
      const unsub = window.privateai.onScriptProgress((ev) => {
        if (ev.token !== token) return
        setPullProgress(ev)
      })
      progressUnsubRef.current = unsub
      try {
        const r: ScriptResult = await window.privateai.runScript(
          'download-models.ps1',
          { Model: m },
          { timeoutMs: 600_000, progressToken: token }
        )
        setLog(JSON.stringify(r, null, 2))
        if (r.ok) await refreshInstalled()
      } finally {
        unsub()
        if (progressUnsubRef.current === unsub) progressUnsubRef.current = null
        setBusyPullId(null)
        setPullProgress(null)
        setPullModelName(null)
      }
    },
    [refreshInstalled]
  )

  const selectCuratedPick = useCallback((tag: string) => {
    userEditedPickerRef.current = true
    setPickerText(tag)
    setPickerMenuOpen(false)
  }, [])

  const pullLine = pullModelName ? pullProgressLine(pullProgress, pullModelName) : null

  return (
    <div>
      <h1 className="page-title">Models</h1>
      <p className="page-sub">
        Open WebUI uses whatever <strong>Ollama</strong> has on this PC. Choose a suggested pick or search the list,
        then download — large files can take many minutes. Set defaults inside Open WebUI (Settings → Models).
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Match models to this PC</h3>
        {!hwFetched ? (
          <p className="muted">Loading last hardware snapshot…</p>
        ) : lastHw?.error ? (
          <p className="muted">Hardware snapshot failed: {lastHw.error}</p>
        ) : !lastHw ? (
          <p className="muted" style={{ marginBottom: 12 }}>
            No snapshot yet. Run <NavLink to="/check-my-pc">Check my PC</NavLink> once, or scan from here — top picks
            order themselves for your GPU, CPU threads, and RAM.
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
            Tuning lives in <code>config/model-profiles.json</code> and <code>config/ollama-model-picks.json</code>.
          </p>
        ) : null}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Top picks for this PC</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          One tap downloads the tag we think fits best right now. Run <strong>Refresh list from Ollama</strong> below
          after a pull to confirm it arrived.
        </p>
        <div className="models-top-grid">
          {topPicks.map(({ profile: p, fit }) => {
            const tag = fit.effectivePull!
            const pullDisabled = busyPullId !== null || fit.label === 'blocked'
            return (
              <div key={p.id} className="models-top-tile">
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                  <h4 className="models-top-tile-title" style={{ margin: 0 }}>
                    {p.label}
                  </h4>
                  <span className={fitPillClass(fit.label)} title={fit.hint}>
                    {fitPillText(fit.label)}
                  </span>
                </div>
                <div className="models-top-tile-tag">{tag}</div>
                <p className="models-top-tile-hint">{hintShort(fit.hint)}</p>
                <ActionButton
                  variant="primary"
                  disabled={pullDisabled}
                  onClick={() => {
                    userEditedPickerRef.current = true
                    setPickerText(tag)
                    void pullModel(tag, p.id)
                  }}
                >
                  {busyPullId === p.id ? 'Downloading…' : 'Download'}
                </ActionButton>
              </div>
            )
          })}
        </div>
        {busyPullId && pullModelName && pullLine ? (
          <div className="models-pull-banner" style={{ marginTop: 14 }} role="status" aria-live="polite">
            <div className="models-pull-line">{pullLine.text}</div>
            <div className={`models-pull-track${pullLine.pct == null ? ' models-pull-indeterminate' : ''}`}>
              <div
                className="models-pull-fill"
                style={pullLine.pct != null ? { width: `${pullLine.pct}%` } : undefined}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Open WebUI</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          After downloads finish, open chat and pick a model in the header. Refresh the model list in Open WebUI if
          needed.
        </p>
        <div className="row-actions" style={{ marginTop: 0 }}>
          <ActionButton variant="primary" onClick={() => void window.privateai.openExternal(openWebUiUrl)}>
            Open chat UI
          </ActionButton>
          <ActionButton
            variant="default"
            onClick={() => void window.privateai.openExternal('https://ollama.com/library')}
          >
            Browse full Ollama library
          </ActionButton>
          <ActionButton variant="ghost" disabled={busyRefresh} onClick={() => void refreshInstalled()}>
            {busyRefresh ? 'Refreshing…' : 'Refresh list from Ollama'}
          </ActionButton>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>Installed in Ollama</h3>
        {installed === null ? (
          <p className="muted">Use &quot;Refresh list from Ollama&quot; above to see what is already on this PC.</p>
        ) : installed.length === 0 ? (
          <p className="muted">Nothing installed yet — download a pick above.</p>
        ) : (
          <ul className="muted" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
            {installed.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3>Pick another model</h3>
        <p className="muted" style={{ marginBottom: 12 }}>
          Type to filter popular tags (same as <code>ollama pull name:tag</code>). You can still type any tag not in
          the list.
        </p>
        <div className="models-picker-wrap">
          <input
            className="models-field"
            style={{ maxWidth: '100%', width: '100%' }}
            aria-label="Search or type Ollama model tag"
            aria-expanded={pickerMenuOpen}
            aria-controls="models-picker-menu"
            autoComplete="off"
            value={pickerText}
            onChange={(e) => {
              userEditedPickerRef.current = true
              setPickerText(e.target.value)
              setPickerMenuOpen(true)
            }}
            onFocus={() => setPickerMenuOpen(true)}
            onBlur={() => {
              window.setTimeout(() => setPickerMenuOpen(false), 160)
            }}
            placeholder="e.g. qwen, mistral, llama3.2"
          />
          {pickerMenuOpen && filteredCurated.length > 0 ? (
            <div id="models-picker-menu" className="models-picker-menu" role="listbox">
              {filteredCurated.map((p) => (
                <button
                  key={p.tag}
                  type="button"
                  role="option"
                  className="models-picker-row"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => selectCuratedPick(p.tag)}
                >
                  <div className="models-picker-row-title">{p.title}</div>
                  {p.note ? <div className="models-picker-row-sub">{p.note}</div> : null}
                  <div className="models-picker-row-tag">{p.tag}</div>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="row-actions" style={{ marginTop: 12, alignItems: 'center' }}>
          <ActionButton
            variant="primary"
            disabled={busyPullId !== null || !pickerText.trim()}
            onClick={() => void pullModel(pickerText.trim(), 'picker')}
          >
            {busyPullId === 'picker' ? 'Downloading…' : 'Download this tag'}
          </ActionButton>
        </div>
      </div>

      <details className="card" style={{ marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--text)' }}>
          All starter profiles (details & hints)
        </summary>
        <p className="muted" style={{ marginTop: 12, marginBottom: 14, fontSize: 14 }}>
          Same data as <code>config/model-profiles.json</code>, sorted for this machine.
        </p>
        <div className="stack">
          {sortedProfiles.map(({ profile: p, fit }) => {
            const pullTag = fit.effectivePull
            const showCatalog = pullTag && p.ollamaPull && pullTag !== p.ollamaPull
            const pullDisabled = !pullTag || busyPullId !== null || fit.label === 'blocked'
            return (
              <div key={p.id} className="card" style={{ background: 'var(--surface-2)' }}>
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
                        (catalog: <code style={{ fontSize: '0.9em' }}>{p.ollamaPull}</code>)
                      </>
                    ) : null}
                  </p>
                ) : (
                  <p className="muted">No Ollama pull for this card.</p>
                )}
                <p className="muted">Approx size: {p.approxSizeGb ?? '?'} GB</p>
                <div className="row-actions">
                  <ActionButton
                    variant="primary"
                    disabled={pullDisabled}
                    onClick={() => pullTag && void pullModel(pullTag, p.id)}
                  >
                    {busyPullId === p.id ? 'Downloading…' : 'Download suggested model'}
                  </ActionButton>
                </div>
              </div>
            )
          })}
        </div>
      </details>

      <div className="card" style={{ marginTop: 20 }}>
        <h3>Last script output</h3>
        <p className="muted" style={{ marginBottom: 8, fontSize: 12 }}>
          JSON from the last refresh or download (for troubleshooting).
        </p>
        <LogPanel text={log} />
      </div>
    </div>
  )
}
