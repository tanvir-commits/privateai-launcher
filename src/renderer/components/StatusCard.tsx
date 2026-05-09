import type { ReactNode } from 'react'

export type StatusTone = 'ok' | 'warn' | 'bad' | 'unknown'

function toneClass(tone: StatusTone): string {
  if (tone === 'ok') return 'ok'
  if (tone === 'warn') return 'warn'
  if (tone === 'bad') return 'bad'
  return 'unknown'
}

export function StatusCard(props: {
  title: string
  description?: string
  tone: StatusTone
  label: string
  /** Shown under the status line (e.g. engine version). */
  subtitle?: string
  /** e.g. a Restart button aligned with the title */
  headerAction?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="card">
      {props.headerAction ? (
        <div className="status-card-top">
          <h3>{props.title}</h3>
          {props.headerAction}
        </div>
      ) : (
        <h3>{props.title}</h3>
      )}
      {props.description ? <p>{props.description}</p> : null}
      <div className="status-dot" style={{ marginTop: 10 }}>
        <span className={'dot ' + toneClass(props.tone)} />
        <span>{props.label}</span>
      </div>
      {props.subtitle ? (
        <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
          {props.subtitle}
        </p>
      ) : null}
      {props.children}
    </div>
  )
}
