import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ActionButton } from '../components/ActionButton'
import { LogPanel } from '../components/LogPanel'
import type { HardwareScanPayload } from '@shared/preloadApi'
import { formatBytes, formatPortEntry, formatVramMiB } from '../lib/formatHardware'
import { buildHardwareVerdictView } from './hardwareVerdict'
import { parseGpuDetails, parseSystemDetails } from './hardwareTypes'

function readinessClass(tier: string | undefined): string {
  if (!tier) return 'unknown'
  if (tier === 'unsupported') return 'bad'
  if (tier === 'basic') return 'warn'
  return 'ok'
}

export default function HardwareDoctor() {
  const [busy, setBusy] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [last, setLast] = useState<HardwareScanPayload | null>(null)

  const scan = async () => {
    setBusy(true)
    try {
      const payload = await window.privateai.scanHardware()
      setLast(payload)
    } finally {
      setBusy(false)
    }
  }

  const sys = parseSystemDetails(last?.system ?? undefined)
  const gpu = parseGpuDetails(last?.gpu ?? undefined)
  const gpuOk = last?.gpu?.ok === true

  const portRows = [
    { key: 'ollama', title: 'Ollama' },
    { key: 'openWebui', title: 'Open WebUI' },
    { key: 'comfyui', title: 'ComfyUI' }
  ]

  const rawDump = ((): string => {
    if (!last) return 'Click “Scan this PC”.'
    const parts: string[] = []
    if (last?.error) parts.push(`Error: ${last.error}`)
    if (last?.system) parts.push(`check-system.ps1:\n${JSON.stringify(last.system, null, 2)}`)
    if (last?.gpu) parts.push(`check-gpu.ps1:\n${JSON.stringify(last.gpu, null, 2)}`)
    return parts.join('\n\n')
  })()

  return (
    <div>
      <h1 className="page-title">Hardware Doctor</h1>
      <p className="page-sub">
        Tells you what this PC can realistically run before you install anything — green / yellow / red style guidance
        for Ollama, Open WebUI (Docker), and Comfy — then you continue to Install with eyes open.
      </p>

      <div className="row-actions">
        <ActionButton variant="primary" disabled={busy} onClick={() => void scan()}>
          {busy ? 'Scanning…' : 'Scan this PC'}
        </ActionButton>
      </div>

      {last?.error ? (
        <div className="card hw-alert hw-alert-error" style={{ marginTop: 16 }}>
          <h3>Scan failed</h3>
          <p className="muted">{last.error}</p>
        </div>
      ) : null}

      {!last && !busy ? (
        <p className="muted" style={{ marginTop: 24 }}>
          Run a scan to get a plain-language verdict, then use Install for the pieces that match your hardware.
        </p>
      ) : null}

      {last && !last.error
        ? (() => {
            const v = buildHardwareVerdictView(last, sys, gpu, gpuOk)
            return (
              <section className={'card hw-verdict hw-verdict--' + v.kind}>
                <div className="hw-verdict-badge">{v.badge}</div>
                <h2 className="hw-verdict-headline">{v.headline}</h2>
                <p className="hw-verdict-lead">{v.explanation}</p>
                <ul className="hw-verdict-lines">
                  {v.lines.map((line) => (
                    <li key={line.name} className={'hw-verdict-line hw-verdict-line--' + line.status}>
                      <span className="hw-verdict-line-name">{line.name}</span>
                      <span className="hw-verdict-line-text">{line.text}</span>
                    </li>
                  ))}
                </ul>
                {v.footnote ? <p className="muted hw-verdict-foot">{v.footnote}</p> : null}
                <div className="hw-verdict-actions">
                  <NavLink to="/install" className="btn btn-primary">
                    Continue to Install
                  </NavLink>
                  <NavLink to="/troubleshooting" className="btn btn-ghost">
                    Troubleshooting
                  </NavLink>
                </div>
              </section>
            )
          })()
        : null}

      {last && !last.error ? (
        <>
          <h2 className="hw-details-title">Scan details</h2>
          <div className="hw-layout">
          <section className="card hw-card">
            <h3 className="hw-card-title">AI readiness</h3>
            {gpu.readinessLabel ? (
              <>
                <div className={'hw-readiness ' + readinessClass(gpu.readiness)}>
                  <span className="hw-readiness-dot" />
                  <span>{gpu.readinessLabel}</span>
                </div>
                {gpu.readiness ? (
                  <p className="hw-readiness-tier muted">Tier: {gpu.readiness}</p>
                ) : null}
                {gpu.readiness === 'unsupported' ? (
                  <p className="muted hw-note" style={{ marginTop: 12 }}>
                    No GeForce/RTX GPU was seen by the scan (common on Intel- or AMD-only laptops). Ollama can still run
                    on CPU; NVIDIA-focused flows in this app may be limited or unsupported.
                  </p>
                ) : null}
              </>
            ) : last.gpu ? (
              <p className="muted">GPU tier could not be determined. See Graphics below.</p>
            ) : (
              <p className="muted">No GPU result yet. Scan again or check the messages below.</p>
            )}
          </section>

          <section className="card hw-card">
            <h3 className="hw-card-title">Graphics</h3>
            <dl className="hw-dl">
              <div className="hw-dl-row">
                <dt>GPU</dt>
                <dd>{gpu.gpuName ?? '—'}</dd>
              </div>
              <div className="hw-dl-row">
                <dt>VRAM</dt>
                <dd>
                  {formatVramMiB(gpu.vramMb)}
                  {gpu.vramMb != null && gpu.vramMb > 0 ? (
                    <span className="muted hw-vram-sub"> ({gpu.vramMb.toLocaleString()} MiB)</span>
                  ) : null}
                </dd>
              </div>
              <div className="hw-dl-row">
                <dt>NVIDIA driver</dt>
                <dd>{gpu.driverVersion ?? '—'}</dd>
              </div>
              <div className="hw-dl-row">
                <dt>Detection</dt>
                <dd className="muted">{gpu.detection ?? '—'}</dd>
              </div>
            </dl>
            {!gpuOk ? (
              <p className="muted hw-note">{last?.gpu?.message ?? 'GPU check did not succeed.'}</p>
            ) : null}
          </section>

          <section className="card hw-card hw-card-wide">
            <h3 className="hw-card-title">System</h3>
            <dl className="hw-dl">
              <div className="hw-dl-row">
                <dt>Windows</dt>
                <dd>{sys.osCaption ?? '—'}</dd>
              </div>
              <div className="hw-dl-row">
                <dt>Build</dt>
                <dd>{sys.osBuild != null ? String(sys.osBuild) : '—'}</dd>
              </div>
              <div className="hw-dl-row">
                <dt>System RAM</dt>
                <dd>{formatBytes(sys.ramBytes)}</dd>
              </div>
              <div className="hw-dl-row">
                <dt>Free on C:</dt>
                <dd>{formatBytes(sys.diskCFreeBytes ?? undefined)}</dd>
              </div>
            </dl>
            {last?.system?.warnings?.length ? (
              <ul className="hw-warnings">
                {last.system.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="card hw-card hw-card-wide">
            <h3 className="hw-card-title">Default ports</h3>
            <div className="hw-ports">
              {portRows.map(({ key, title }) => {
                const { label, busy } = formatPortEntry(sys.ports, key)
                return (
                  <div key={key} className="hw-port-row">
                    <span className="hw-port-name">{title}</span>
                    <span
                      className={
                        'hw-port-status' +
                        (busy === true ? ' busy' : busy === false ? ' free' : '')
                      }
                    >
                      {label}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="muted hw-note">
              “In use” only means something is listening; the launcher does not stop other apps.
            </p>
          </section>
        </div>
        </>
      ) : null}

      {last?.error ? (
        <p className="muted" style={{ marginTop: 16 }}>
          Fix the error above, then scan again for a verdict and detailed cards.
        </p>
      ) : null}

      <div className="card" style={{ marginTop: 20 }}>
        <div className="hw-raw-header">
          <h3>Technical details</h3>
          <ActionButton variant="ghost" disabled={!last} onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? 'Hide raw JSON' : 'Show raw JSON'}
          </ActionButton>
        </div>
        {showRaw && last ? <LogPanel text={rawDump} /> : null}
        {showRaw && !last ? <p className="muted">Scan first to see raw output.</p> : null}
      </div>
    </div>
  )
}
